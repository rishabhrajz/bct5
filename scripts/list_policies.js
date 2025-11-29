const hre = require("hardhat");

async function main() {
    console.log("Checking PolicyContract state...");

    const deployed = require("../frontend/public/deployments/deployed.json");
    const policyContractAddress = deployed.contracts.PolicyContract;

    const PolicyContract = await hre.ethers.getContractFactory("PolicyContract");
    const policyContract = PolicyContract.attach(policyContractAddress);

    // Try to read policyCounter (it's private, so we can't read it directly unless there's a getter)
    // But we can try to read policies 1, 2, 3... until we hit an empty one.

    for (let i = 1; i <= 5; i++) {
        const policy = await policyContract.policies(i);
        if (policy.beneficiary !== "0x0000000000000000000000000000000000000000") {
            console.log(`Policy #${i} exists:`);
            console.log(`  Status: ${policy.status}`);
            console.log(`  Beneficiary: ${policy.beneficiary}`);
        } else {
            console.log(`Policy #${i} does not exist.`);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
