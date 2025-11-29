const hre = require("hardhat");

async function main() {
    const policyId = 5;
    console.log(`Checking status for Policy #${policyId} on OLD contract...`);

    const oldContractAddress = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";

    const PolicyContract = await hre.ethers.getContractFactory("PolicyContract");
    const policyContract = PolicyContract.attach(oldContractAddress);

    const policy = await policyContract.policies(policyId);

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
