// bojK8sCommand.js
// Runs bags-of-jobs on a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
var submitK8sJob = require('./k8sJobSubmit.js').submitK8sJob;
var fs = require('fs');
const delay = ms => new Promise(res => setTimeout(res, ms));
const LABEL = "bag-of-jobs-label";

async function getNodeToSchedule(jobSetIdx, availNodes) {
  while(true) {
    let nodeIndex = availNodes.indexOf(1);
    if (nodeIndex !== -1) { console.log("Job set", jobSetIdx + ": assigning node", nodeIndex); return nodeIndex; }
    await delay(5000);
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
  const kubeconfig = new k8s.KubeConfig();
  kubeconfig.loadFromDefault();
  var jobExitCodes = [];

  if (text.startsWith("bagOfJobs")) {
    let jobsFileName = ins["jobSetsFile"].data[0];
    let jobSets = JSON.parse(fs.readFileSync(jobsFileName));

    const k8sApi = kubeconfig.makeApiClient(k8s.CoreV1Api);

    // get all nodes
    const nodesResponse = await k8sApi.listNode('default');
    const nodes = nodesResponse.body.items.filter(node => node.metadata.labels['nodetype'] === 'worker');
    const nodeNames = nodes.map(node => node.metadata.name);
    const availNodes = nodeNames.map(node  => 1);
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

    for (let jobSetIndex in jobSets) {
      console.log("iteration", jobSetIndex);
      const nodeIndex = await getNodeToSchedule(jobSetIndex, availNodes);
      const nodeToSchedule = nodeNames[nodeIndex];
      console.log("JobSet " + jobSetIndex + " scheduled to node " + nodeToSchedule);
      availNodes[nodeIndex] = 0;
      console.log("Node(" + nodeIndex + ") reserved: " + availNodes);
      let exitCodes = submitJobSet(jobSetIndex, jobSets[jobSetIndex], nodeToSchedule, context, kubeconfig, availNodes, nodeIndex);
      jobExitCodes.push(exitCodes);
      await delay(1000);
    }
    let codes = await Promise.all(jobExitCodes);
    console.log(JSON.stringify(codes));
  } else {
    let stepsFileName = ins["workload"].data[0];
    let steps = JSON.parse(fs.readFileSync(stepsFileName));

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      step = steps[stepIndex];
      let exitCodes = submitJobStep(stepIndex, step, context, kubeconfig);
      jobExitCodes.push(exitCodes);
      console.log("Finished initializing step " + stepIndex)
      await delay(step.interval * 1000);
    }
    jobExitCodes = await Promise.all(jobExitCodes);
    console.log("Finished workload with exit codes:")
    console.log(jobExitCodes);
  }

  let functionEnd = Date.now();
  console.log("[DEBUG] bojK8sInvoke exiting, time:", functionEnd);
  cb(null, outs);
}

async function submitJobStep(stepIndex, step, context, kubeconfig) {
  var jobPromises = [];
  jobs = step.jobs;
  jobPromises = (jobs.map(job => {
    let taskId = context.hfId + ":" + job.step + ":" + job.job + ":1"
    let customParams = {
      jobName: '.workload.' + job.name.replace(/_/g, '-') + '.' + job.step + '.' + job.job,
      imageName: job.image,
      firingLimit: job.firingLimit,
      type: job.name + "-" + job.workflow + "-" + job.size,
      size: 100,
      schedulerName: "collocation-scheduler"
    };
    return submitK8sJob(kubeconfig, job, taskId, context, customParams);
  }));
  const jobExitCodes = await Promise.all(jobPromises);
  console.log("Finished job step", stepIndex, "exit codes: " + jobExitCodes);
  return jobExitCodes;
}

async function submitJobSet(jobSetIndex, jobSet, nodeToSchedule, context, kubeconfig, availNodes, nodeIndex) {
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
  availNodes[nodeIndex] = 1;
  console.log("Node(" + nodeIndex + ") released: " + availNodes);
  console.log("Finished job set", jobSetIndex, "exit codes: " + jobExitCodes);
  return jobExitCodes;
}

exports.bojK8sCommand = bojK8sCommand;
