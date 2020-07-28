// bojK8sCommand.js
// Runs bags-of-jobs on a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
var submitK8sJob = require('./k8sJobSubmit.js').submitK8sJob;
var fs = require('fs');
const PromisePool = require('@supercharge/promise-pool');
var path = require('path');

function copyFileSync( source, target ) {

  var targetFile = target;

  //if target is a directory a new file with the same name will be created
  if ( fs.existsSync( target ) ) {
    if ( fs.lstatSync( target ).isDirectory() ) {
      targetFile = path.join( target, path.basename( source ) );
    }
  }

  fs.writeFileSync(targetFile, fs.readFileSync(source));
}

function copyFolderRecursiveSync( source, target ) {
  var files = [];

  //check if folder needs to be created or integrated
  var targetFolder = path.join( target, path.basename( source ) );
  if ( !fs.existsSync( targetFolder ) ) {
    fs.mkdirSync( targetFolder );
  }

  //copy
  if ( fs.lstatSync( source ).isDirectory() ) {
    files = fs.readdirSync( source );
    files.forEach( function ( file ) {
      var curSource = path.join( source, file );
      if ( fs.lstatSync( curSource ).isDirectory() ) {
        copyFolderRecursiveSync( curSource, targetFolder );
      } else {
        copyFileSync( curSource, targetFolder );
      }
    } );
  }
}


async function bojK8sCommand(ins, outs, context, cb) {
  let functionStart = Date.now();
  console.log("[DEBUG] bojK8sInvoke called, time:", functionStart);
  // let cluster = await getCluster();
  // const token = await getGCPToken();

  // support for two clusters (cloud bursting) 
  // if 'HF_VAR_REMOTE_CLUSTER' is defined, we check where this job is assigned to:
  // - the local cluster: we do nothing
  // - the remote cluster: we set KUBECONFIG to load its configuration
  var remoteClusterId = process.env.HF_VAR_REMOTE_CLUSTER;
  if (remoteClusterId) {
    let partition = job.partition;
    if (partition === remoteClusterId) {
      // this will cause reading the kube_config of the remote cluster
      process.env.KUBECONFIG = process.env.HF_VAR_KUBE_CONFIG_PATH || "./kube_config";
    }
  }

  const text = fs.readFileSync("/hyperflow/examples/BagOfJobs/commandType");

  if (text.startsWith("bagOfJobs")) {
    const kubeconfig = new k8s.KubeConfig();
    kubeconfig.loadFromDefault();

    let jobsFileName = ins["jobSetsFile"].data[0];
    let jobs = JSON.parse(fs.readFileSync(jobsFileName));

    const k8sApi = kubeconfig.makeApiClient(k8s.CoreV1Api);

    // get all nodes
    const nodesResponse = await k8sApi.listNode('default');
    const nodes = nodesResponse.body.items;
    const numberOfNodes = nodes.length;
    const LABEL = "my-label";
    const headers = {'content-type': 'application/merge-patch+json'};

    // create node selector label for all nodes
    for (const node of nodes) {
      const label = {
        "metadata": {
          "labels": { }
        }
      };
      label.metadata.labels[LABEL] = node.metadata.name;
      await k8sApi.patchNode(node.metadata.name, label, undefined, undefined, undefined, undefined, {headers});
    }

    copyFolderRecursiveSync('/work_dir', "/hyperflow/examples/BagOfJobs");

    // run job sets in parallel with concurrency limit
    const { results, errors } = await PromisePool
        .for(jobs)
        .withConcurrency(numberOfNodes)
        .process(async jobs => {
          copyFolderRecursiveSync('/hyperflow/examples/BagOfJobs/work_dir', "/");
          jobPromises = jobs.map(job => {
            let taskId = context.hfId + ":" + job.setId + ":" + job.jobId + ":1"
            let set = parseInt(job.setId);
            let nodeToSchedule = nodes[set%numberOfNodes];
            let nodeSelector = nodeToSchedule.metadata.labels[LABEL];
            let customParams = {
              jobName: '.job-sets.' + job.name.replace(/_/g, '-') + '.' + job.setId + '.' + job.jobId,
              labelKey: LABEL,
              labelValue: nodeSelector,
              imageName: job.image,
              firingLimit: job.firingLimit,
            };

            return submitK8sJob(kubeconfig, job, taskId, context, customParams);
          });
          jobExitCodes = await Promise.all(jobPromises);
          return jobExitCodes;
        });

    console.log(results, errors);
  } else {
    let stepsFileName = ins["jobSetsFile"].data[1];
    let steps = JSON.parse(fs.readFileSync(stepsFileName));

    jobPromises = []

    for (let i = 0; i < steps.length; i++) {
      step = steps[i];
      jobs = step.jobs;
      jobPromises.append(jobs.map(job => {
        let taskId = context.hfId + ":" + job.step + ":" + job.job + ":1"
        let customParams = {
          jobName: '.job-sets.' + job.name.replace(/_/g, '-') + '.' + job.set + '.' + job.job,
          imageName: job.image,
          firingLimit: job.firingLimit,
          type: job.name + "-" + job.workflow + "-" + job.size,
          size: 100
        };

        return submitK8sJob(kubeconfig, job, taskId, context, customParams);
      }));

      console.log("Finished initializing step " + i + " with jobCodes")
      wait(step.interval * 1000);
    }
    jobExitCodes = await Promise.all(jobPromises);
    console.log("Finished workload with exit codes:")
    console.log(jobExitCodes);
  }

  let functionEnd = Date.now();
  console.log("[DEBUG] bojK8sInvoke exiting, time:", functionEnd);
  cb(null, outs);
}

function wait(ms){
  var start = new Date().getTime();
  var end = start;
  while(end < start + ms) {
    end = new Date().getTime();
  }
}

exports.bojK8sCommand = bojK8sCommand;
