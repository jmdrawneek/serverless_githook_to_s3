const DeploymentTools = require('serverless_githook_to_s3');

exports.handler = (event, context, callback) => {
  const bucketName = process.env.BUCKET;
  const gitHookKey = process.env.GITHUB_WEBHOOK_SECRET;
  const gitAPIkey = process.env.GITHUB_API_TOKEN;

  const deploymentTools = new DeploymentTools(null, event, callback, bucketName, gitHookKey, gitAPIkey, 'docs');

  // Process incoming gitHook event.
  if(deploymentTools.processIncommingGitHook()) {
    async function task  () {

      console.log(`${files} added ready for deployment`);

      const branchName = await deploymentTools.listGitRepoBranches('get deployed');

      await deploymentTools.getFilesFromGit(branchName)

      await deploymentTools.putFilesOnS3()

      deploymentTools.closeTask();
    }
  }
};
