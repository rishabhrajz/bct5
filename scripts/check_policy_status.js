const hre = require("hardhat");

async function main() {
    const policyId = 5; // Checking Policy #5
    console.log(`Checking status for Policy #${policyId}...`);

    // Get the deployed PolicyContract address
    const deployed = require("../frontend/public/deployments/deployed.json");
    const policyContractAddress = deployed.contracts.PolicyContract;

    const PolicyContract = await hre.ethers.getContractFactory("PolicyContract");
    const policyContract = PolicyContract.attach(policyContractAddress);

    const policy = await policyContract.policies(policyId);

    // Map enum to string
    const statusMap = ["Pending", "Approved", "Rejected", "Active", "Expired"];
    const status = statusMap[policy.status];

    console.log(`On-Chain Policy Status: ${status} (${policy.status})`);
    console.log(`Beneficiary: ${policy.beneficiary}`);
    console.log(`Coverage: ${hre.ethers.formatEther(policy.coverageAmount)} ETH`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
