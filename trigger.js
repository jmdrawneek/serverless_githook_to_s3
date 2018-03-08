const DeploymentTools = require('serverless_githook_to_s3');

exports.handler = async (event, context, callback) => {
  const bucketName = process.env.BUCKET;
  const gitHookKey = process.env.GITHUB_WEBHOOK_SECRET;
  const gitAPIkey = process.env.GITHUB_API_TOKEN;

  const allowedPrefixes = ['beta-'];

  const releaseRef = event.body.ref.split('/');
  if (releaseRef[1] === 'tags' && checkPrefix(releaseRef[2])) {

    const deploymentTools = new DeploymentTools(null, event, callback, bucketName, gitHookKey, gitAPIkey, 'dist');

    // Process incoming gitHook event.
    if (deploymentTools.processIncommingGitHook()) {
      const branchName = await deploymentTools.listGitRepoBranches('get deployed');
      await deploymentTools.getFilesFromGit(branchName);
      await deploymentTools.putFilesOnS3();

      deploymentTools.closeTask();
    }
  }
  else {
    const response = {
      statusCode: 200,
      body: JSON.stringify({
        input: this.event
      })
    };

    return callback(null, response);
  }

  function checkPrefix(tag) {
    let result = false;
    allowedPrefixes.forEach((allowed) => {
      if (!result) result = tag.startsWith(allowed);
    })
  }
};
