const DeploymentTools = require('serverless_githook_to_s3');

exports.handler = (event, context, callback) => {
  const bucketName = process.env.BUCKET;
  const gitHookKey = process.env.GITHUB_WEBHOOK_SECRET;
  const gitAPIkey = process.env.GITHUB_API_TOKEN;

  const deploymentTools = new DeploymentTools(null, event, callback, bucketName, gitHookKey, 'docs');

  // Process incoming gitHook event.
  deploymentTools.processIncommingGitHook()
  .then(files => {
    console.log(`${files} added ready for deployment`);

    deploymentTools.listGitRepoBranches();

    deploymentTools.putFilesOnS3(gitAPIkey)
    .then(() => {
      deploymentTools.closeTask();
    });

  });
};
