const crypto = require('crypto');
const request = require('request');
const AWS = require('aws-sdk');
const fs = require('fs');
const zlib = require('zlib');

module.exports = class DeploymentTools {
  constructor (credentials, event, callback, bucketName, gitHookKey, gitAPIkey, path) {
    this.credentials = credentials;
    this.token = gitHookKey;
    this.gitAPIkey = gitAPIkey;
    this.event = event;
    this.callback = callback;
    this.bucketName = bucketName;
    this.files = [];
    this.tag = event.body.ref.split('/')[2];
    const refParts = event.body.ref.split('/');
    this.releaseFolder = refParts[refParts.length - 1].replace(/\./g, '-').replace(/^rc-/g, '');
    console.log('The release folder will be', this.releaseFolder);

    let replacePath = (typeof path === 'string') ? path : '';

    this.uri = event.body.repository.contents_url.replace('{+path}', replacePath);
    // If there is no head commit, use the previous commit.
    this.lastCommit = event.body.head_commit.id || event.body.before;

    this.owner = event.body.repository.full_name.split('/')[0];
    this.repo = event.body.repository.full_name.split('/')[1];

    this.path = path;
    this.s3 = new AWS.S3({
      params: {
        Bucket: bucketName
      }
    });

    console.log('Completed setting up object.');
  }

  /**
   * Takes the event setup in the constructor error handles and authenticates.
   *
   * @returns {Promise}
   */
  processIncommingGitHook() {
    console.log('Processing Incoming githook.');
    let errMsg = null;
    const headers = this.event.headers;
    const sig = headers['X-Hub-Signature'];
    const githubEvent = headers['X-GitHub-Event'];
    const id = headers['X-GitHub-Delivery'];
    const calculatedSig = this.signRequestBody(this.token, this.event.body);

    if (typeof this.token !== 'string') {
      errMsg = 'Must provide a \'GITHUB_WEBHOOK_SECRET\' env variable';
      console.log(errMsg);
      return callback(null, {
        statusCode: 401,
        headers: { 'Content-Type': 'text/plain' },
        body: errMsg,
      });
    }

    if (!sig) {
      errMsg = 'No X-Hub-Signature found on request';
      console.log(errMsg);
      return callback(null, {
        statusCode: 401,
        headers: { 'Content-Type': 'text/plain' },
        body: errMsg,
      });
    }

    if (!githubEvent) {
      errMsg = 'No X-Github-Event found on request';
      console.log(errMsg);
      return callback(null, {
        statusCode: 422,
        headers: { 'Content-Type': 'text/plain' },
        body: errMsg,
      });
    }

    if (!id) {
      errMsg = 'No X-Github-Delivery found on request';
      console.log(errMsg);
      return callback(null, {
        statusCode: 401,
        headers: { 'Content-Type': 'text/plain' },
        body: errMsg,
      });
    }

    if (sig !== calculatedSig) {
      errMsg = 'X-Hub-Signature incorrect. Github webhook token doesn\'t match';
      console.log(errMsg);
      return callback(null, {
        statusCode: 401,
        headers: { 'Content-Type': 'text/plain' },
        body: errMsg,
      });
    }

    /* eslint-disable */
    console.log('---------------------------------');
    console.log(`Github-Event: "${githubEvent}" with action: "${this.event.body.action}"`);
    console.log('---------------------------------');
    console.log('Payload', this.event.body);
    /* eslint-enable */

    return true;
  }

  /**
   * Create a sha1 from the body to compare with the sha1 in the head to make sure
   * this event is legit.
   *
   * @param key {string} api key
   * @param body {object} raw event payload
   * @returns {string}
   */
  signRequestBody(key, body) {
    let hmac = crypto.createHmac("sha1", key);
    hmac.update(JSON.stringify(body), "utf-8");
    return "sha1=" + hmac.digest("hex");
  }

  /**
   *
   * @param type
   * @returns {Promise<any>}
   */
  listGitRepoBranches(type) {
    console.log('Listing branches for gitrepo.');

    const target = {
      uri: `https://api.github.com/repos/${this.owner}/${this.repo}/branches?per_page=100`,
      headers: {
        'User-Agent': 'AWS Lambda Function' // Without that Github will reject all requests
      }
    };

    return new Promise((resolve, reject) => {
      const requestCallback = (error, response, body) => {
        if (error) {
          this.callback(error, `Fetching the branch lists from: ${this.repo} failed.`);
        }

        let result = null;

        switch (type) {
          case 'get deployed':
            console.log('debug branches: ', body);
            const branchObj = JSON.parse(body).filter(item => item.commit.sha === this.lastCommit);
            console.log('debug branch: ', branchObj);
            console.log('Looking for commit: ', this.lastCommit);
            result = branchObj[0].name;
            break;
          default:
            result = body;
        }

        return resolve(result);
      };

      return request
      .get(target, requestCallback)
      .auth(null, null, true, this.gitAPIkey)
      .on('response', function(response) {
        console.log(response.statusCode)
        console.log(response.headers['content-type']);
      })
    })
  }

  /**
   *
   * @param downloadsUrl
   * @returns {Promise<any>}
   */
  getFilesFromGit(branchName) {
    console.log('Getting files from branch ' + branchName);
    const downloadsUrl = typeof branchName === 'undefined' ? this.uri : this.uri + '?ref=' + branchName;
    const target = {
      uri: downloadsUrl,
      headers: {
        'User-Agent': 'AWS Lambda Function' // Without that Github will reject all requests
      }
    };

    return new Promise((resolve, reject) => {
      const requestCallback = (error, response, body) => {
        if (error) {
          this.callback(error,
            `Fetching the resources from: ${downloadsUrl} failed.`);
        }

        const bodyObj = JSON.parse(body);
        console.log('File response body: ', bodyObj);

        bodyObj.forEach((fileObject, index) => {
          this.files.push(fileObject);
        });

        console.log('Files', this.files);

        return resolve(this.files.length);
      };

      return request
      .get(target, requestCallback)
      .auth(null, null, true, this.gitAPIkey)
      .on('response', function (response) {
          console.log(response.statusCode) // 200
          console.log(response.headers['content-type'])
        })

    });
  }

  /**
   *
   * @returns {Promise<any>}
   */
  putFilesOnS3() {
    console.log('Putting files on S3 in' + this.releaseFolder);
    return new Promise((resolve, reject) => {
      // fileObject, folder
      this.files.forEach((fileObject, index) => {
        const gzip = zlib.createGzip();
        request(fileObject.download_url)
        .pipe(gzip)
        .pipe(fs.createWriteStream(`/tmp/${fileObject.name}`))
        .on('finish', () => {
          console.log('Got files, putting on S3');
          this.s3.upload({
            Bucket: this.bucketName,
            Key: this.releaseFolder + '/' + fileObject.name,
            Body: fs.createReadStream(`/tmp/${fileObject.name}`),
            ACL: 'public-read',
            CacheControl: 'max-age=31536000',
            ContentType: this.computeContentType(fileObject.name)
          }, (error) => {
            if (error) {
              throw new Error('Error connecting to s3 bucket. ' + error);
            }
            else {
              console.log('Successfully put files on s3');
              return resolve();
            }
          });
        })
          .on('error', function(err) {
            console.log('Failed to put files on s3 ', err)
          })
      })

    })
  }

  /**
   *
   * @param filename
   * @returns {string}
   */
  computeContentType (filename) {
    const parts = filename.split('.');
    console.log(filename.split('.')[parts.length - 1]);
    switch (filename.split('.')[parts.length - 1]) {
      case 'png':
        return "image/png";
      case 'jpeg':
        return "image/jpeg";
      case 'jpg':
        return "image/jpeg";
      case 'gif':
        return "image/gif";
      case 'html':
        return "text/html";
      case 'js':
        return "application/javascript";
      case 'css':
        return "text/css";
      case 'sass':
        return "text/css";
      case 'svg':
        return "image/svg+xml";
    }
  }

  /**
   *
   * @returns {*}
   */
  closeTask() {
    const response = {
      statusCode: 200,
      body: JSON.stringify({
        input: this.event
      })
    };

    return this.callback(null, response);
  }
};
