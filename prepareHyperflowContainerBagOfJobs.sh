if [ "$#" -ne 1 ]; then
    echo "Illegal number of arguments - give name of hyperflow pod"
fi

if [ "$#" == 1 ]; then
    kubectl cp ./functions/kubernetes/bojK8sCommand.js $1:/hyperflow/functions/kubernetes/
    kubectl cp ./functions/kubernetes/k8sJobSubmit.js $1:/hyperflow/functions/kubernetes/
    kubectl cp ./examples/BagOfJobs/job_sets.json $1:/hyperflow/examples/BagOfJobs/
    kubectl cp ./examples/BagOfJobs/job-template.yaml $1:/hyperflow/examples/BagOfJobs/
    kubectl cp ./examples/BagOfJobs/workflow.json $1:/hyperflow/examples/BagOfJobs/
    kubectl cp ./examples/BagOfJobs/commandType $1:/hyperflow/examples/BagOfJobs/
fi

