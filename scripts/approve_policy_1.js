const hre = require("hardhat");

async function main() {
    const policyId = 1;
    console.log(`Approving Policy #${policyId} on-chain...`);

    // Get the deployed PolicyContract address
    const deployed = require("../deployments/deployed.json");
    const policyContractAddress = deployed.contracts.PolicyContract;

    const PolicyContract = await hre.ethers.getContractFactory("PolicyContract");
    const policyContract = PolicyContract.attach(policyContractAddress);

    // Approve the policy (must be called by insurer/owner)
    const tx = await policyContract.approvePolicy(policyId);
    await tx.wait();

    console.log(`✅ Policy #${policyId} approved on-chain!`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
