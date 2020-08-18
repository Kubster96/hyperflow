// bojK8sCommand.js
// Runs bags-of-jobs on a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
var submitK8sJob = require('./k8sJobSubmit.js').submitK8sJob;
var fs = require('fs');
const PromisePool = require('@supercharge/promise-pool');
const delay = ms => new Promise(res => setTimeout(res, ms));
const LABEL = "bag-of-jobs-label";

async function getNodeToSchedule(k8sApi, nodeNames) {
  while (true) {
    const podsResponse = await k8sApi.listNamespacedPod('default');
    const usedNodeNames = podsResponse.body.items.filter(pod => pod.metadata.name.startsWith("job.job-sets")).filter(pod => pod.status.phase !== 'Succeeded').map(pod => pod.spec.nodeName);
    const notUsedNodesNames = nodeNames.filter(nodeName => usedNodeNames.indexOf(nodeName) === -1);

    if (notUsedNodesNames.length === 0) {
      await delay(5000);
    } else {
      return notUsedNodesNames[0];
    }
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

  const text = fs.readFileSync("/hyperflow/examples/BagOfJobs/commandType", { encoding: 'utf8', flag: 'r' });

  if (text.startsWith("bagOfJobs")) {
    const kubeconfig = new k8s.KubeConfig();
    kubeconfig.loadFromDefault();

    let jobsFileName = ins["jobSetsFile"].data[0];
    let jobSets = JSON.parse(fs.readFileSync(jobsFileName));

    const k8sApi = kubeconfig.makeApiClient(k8s.CoreV1Api);

    // get all nodes
    const nodesResponse = await k8sApi.listNode('default');
    const nodes = nodesResponse.body.items.filter(node => node.metadata.labels['nodetype'] === 'worker');
    const nodeNames = nodes.map(node => node.metadata.name);

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

    var jobExitCodes = [];
    for (let jobSetIndex in jobSets) {
      console.log("iteration", jobSetIndex);
      const nodeToSchedule = await getNodeToSchedule(k8sApi, nodeNames);
      console.log("JobSet " + jobSetIndex + " scheduled to node " + nodeToSchedule);
      let exitCodes = submitJobSet(jobSetIndex, jobSets[jobSetIndex], nodeToSchedule, context, kubeconfig);
      jobExitCodes.push(exitCodes);
      await delay(1000);
    }
    let codes = await Promise.all(jobExitCodes);
    console.log(JSON.stringify(codes));
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

async function submitJobSet(jobSetIndex, jobSet, nodeToSchedule, context, kubeconfig) {
  var jobPromises = [];
  jobPromises = (jobSet.map(job => {
    let taskId = context.hfId + ":" + job.setId + ":" + job.jobId + ":1";
    let nodeSelector = nodeToSchedule;
    console.log("Submitted job " + job.name + " number " + job.jobId + " set " + job.setId + " to node " + nodeSelector);
    let customParams = {
      jobName: '.job-sets.' + job.name.replace(/_/g, '-') + '.' + job.setId + '.' + job.jobId,
      labelKey: LABEL,
      labelValue: nodeSelector,
      imageName: job.image,
      firingLimit: job.firingLimit,
    };
    return submitK8sJob(kubeconfig, job, taskId, context, customParams);
  }));
  const jobExitCodes = await Promise.all(jobPromises);
  console.log("Finished job set", jobSetIndex, "exit codes: " + jobExitCodes);
  return jobExitCodes;
}

function wait(ms){
  var start = new Date().getTime();
  var end = start;
  while(end < start + ms) {
    end = new Date().getTime();
  }
}

exports.bojK8sCommand = bojK8sCommand;
