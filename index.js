const crypto = require('crypto');
const request = require('request');
const AWS = require('aws-sdk');

module.exports = class DeploymentTools {
  constructor (credentials, event, callback, bucketName, gitHookKey, path) {
    this.credentials = credentials;
    this.token = gitHookKey;
    this.event = event;
    this.callback = callback;
    this.bucketName = bucketName;

    let replacePath = (typeof path !== 'undefined') ? path : '';

    console.log(event);

    this.uri = event.payload.repository.contents_url.replace('{+path}', replacePath);
    this.path = path;
    this.s3 = new AWS.S3({
      params: {
        Bucket: bucketName
      }
    });
  }

  processIncommingGitHook() {
      let errMsg = null;
      const headers = event.headers;
      const sig = headers['X-Hub-Signature'];
      const githubEvent = headers['X-GitHub-Event'];
      const id = headers['X-GitHub-Delivery'];
      const calculatedSig = this.signRequestBody(this.token, this.event.body.toString());

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
      console.log('Payload', event.body);
      /* eslint-enable */


      return this.getFilesFromGit(this.uri)
      .then(() => {

      })
        .then(() => {
        const response = {
          statusCode: 200,
          body: JSON.stringify({
            input: this.event
          })
        };

        return this.callback(null, response);
      })




    }

  signRequestBody(key, body) {
    return `sha1=${crypto.createHmac('sha1', key).update(body, 'utf-8').digest('hex')}`;
  }

  getFilesFromGit(downloadsUrl) {
    const target = {
      uri: downloadsUrl,
      headers: {
        'User-Agent': 'AWS Lambda Function' // Without that Github will reject all requests
      }
    }

    return request(target, (error, response, body) => {
      if (error) {
        this.callback(error, `Fetching the resources from: ${downloadsUrl} failed.`);
      }

      console.log(JSON.parse(body));
      dsfsdfsf;


      return new Promise((resolve, reject) => {

        JSON.parse(body).forEach((fileObject, index) => {
          this.files.push(fileObject)
        })
      })


    });
  }

  putFilesOnS3() {
    return new Promise((resolve, reject) => {
      // fileObject, folder
      this.files.forEach((fileObject, index) => {
        request(fileObject.download_url)
        .pipe(fs.createWriteStream(`/tmp/${fileObject.name}`))
        .on('finish', () => {
          this.s3.upload({
            Bucket: bucketName,
            Key: folder + fileObject.name,
            Body: fs.createReadStream(`/tmp/${fileObject.name}`),
            ACL: 'public-read',
            CacheControl: 'max-age=31536000',
            ContentType: this.computeContentType(fileObject.name)
          }, (error) => {
            if (error) {
              throw new Error('Error connecting to s3 bucket. ' + error);
            }
            else return resolve();
          });
        });
      })

    })
  }

  computeContentType (filename) {
    const parts = filename.split('.');
    console.log(filename.split('.')[parts.length - 1]);
    switch (filename.split('.')[parts.length - 1]) {
    case 'png':
    return "image/png";
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
}
