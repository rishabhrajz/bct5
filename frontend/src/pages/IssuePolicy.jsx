import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { WalletConnect } from '../components/WalletConnect';
import { useWallet } from '../hooks/useWallet';
import { getProviderAndSigner, getContracts, parseEth, formatEth } from '../utils/contracts';

const API_BASE = 'http://localhost:4000';

const POLICY_TIERS = {
    Basic: { rate: 0.01, label: 'Basic (1% premium)' },
    Standard: { rate: 0.02, label: 'Standard (2% premium)' },
    Premium: { rate: 0.03, label: 'Premium (3% premium)' },
};

export default function IssuePolicy() {
    const { account, isConnected } = useWallet();
    const [coverageEth, setCoverageEth] = useState('1');
    const [tier, setTier] = useState('Standard');
    const [durationDays, setDurationDays] = useState('365');
    const [kycCid, setKycCid] = useState('');
    const [requesting, setRequesting] = useState(false);

    // Fetch KYC status
    const { data: kycDocs } = useQuery({
        queryKey: ['kyc', account],
        queryFn: async () => {
            if (!account) return [];
            const res = await fetch(`${API_BASE}/kyc/${account}`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.documents;
        },
        enabled: !!account,
    });

    const verifiedKyc = kycDocs?.find(doc => doc.status === 'VERIFIED');
    const premium = parseFloat(coverageEth) * POLICY_TIERS[tier].rate;

    const handleRequestPolicy = async () => {
        if (!verifiedKyc) {
            toast.error('Please complete KYC verification first');
            return;
        }

        if (!coverageEth || parseFloat(coverageEth) <= 0) {
            toast.error('Invalid coverage amount');
            return;
        }


        setRequesting(true);
        try {
            const { signer } = await getProviderAndSigner();
            const { policyContract } = getContracts(signer);

            const now = Math.floor(Date.now() / 1000);
            const startEpoch = now + 60; // Start 1 minute from now
            const endEpoch = startEpoch + (parseInt(durationDays) * 24 * 60 * 60);

            const coverageWei = parseEth(coverageEth);
            const premiumWei = parseEth(premium.toFixed(18));

            // Map tier to enum
            const tierEnum = tier === 'Basic' ? 0 : tier === 'Standard' ? 1 : 2;

            toast.loading('Requesting MetaMask approval...');

            const tx = await policyContract.requestPolicy(
                account, // beneficiary
                coverageWei,
                tierEnum,
                startEpoch,
                endEpoch,
                verifiedKyc.documentCid,
                { value: premiumWei }
            );

            toast.loading('Transaction submitted, waiting for confirmation...');
            const receipt = await tx.wait();

            // Extract policy ID from transaction events
            const policyRequestedEvent = receipt.logs.find(
                log => log.fragment && log.fragment.name === 'PolicyRequested'
            );
            const onchainPolicyId = policyRequestedEvent ? policyRequestedEvent.args[0].toString() : '0';

            toast.loading('Saving policy to database...');

            // Save policy to backend database with transaction verification
            const backendRes = await fetch(`${API_BASE}/policy/record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    txHash: receipt.hash,  // Transaction hash for verification
                    beneficiaryAddress: account,
                    beneficiaryDid: `did:ethr:localhost:${account}`,
                    coverageAmount: coverageWei.toString(),
                    startEpoch,
                    endEpoch,
                    tier,
                    premiumAmount: premiumWei.toString(),
                    kycCid: verifiedKyc.documentCid,
                }),
            });

            if (!backendRes.ok) {
                console.error('Backend save failed, but blockchain transaction succeeded');
                toast.error('⚠️ Policy created on blockchain but database save failed');
            } else {
                const result = await backendRes.json();
                console.log('✅ Policy recorded:', result);
            }

            toast.dismiss();
            toast.success('✅ Policy requested! Premium held in escrow. Awaiting verification.');

            // Show success message and redirect to patient dashboard after 2 seconds
            setTimeout(() => {
                window.location.href = '/patient';
            }, 2000);

        } catch (error) {
            toast.dismiss();
            console.error('Policy request error:', error);

            if (error.code === 'ACTION_REJECTED') {
                toast.error('Transaction rejected by user');
            } else {
                toast.error(`Failed to request policy: ${error.message}`);
            }
        } finally {
            setRequesting(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
                <h1 className="text-3xl font-bold mb-2">📋 Request Insurance Policy</h1>
                <p className="text-gray-600">Purchase insurance policy with premium payment in ETH</p>
            </div>

            <WalletConnect />

            {isConnected && (
                <>
                    {/* KYC Status Check */}
                    {!verifiedKyc && (
                        <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
                            <p className="text-yellow-800 font-semibold">⚠️ KYC Verification Required</p>
                            <p className="text-sm text-yellow-600 mt-1">
                                Please complete KYC verification on the Patient Dashboard before purchasing a policy.
                            </p>
                            <a
                                href="/patient"
                                className="mt-3 inline-block bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded text-sm"
                            >
                                Go to Patient Dashboard
                            </a>
                        </div>
                    )}

                    {verifiedKyc && (
                        <div className="bg-white rounded-lg shadow-md p-6">
                            <h2 className="text-xl font-bold mb-4">Policy Details</h2>

                            <div className="space-y-4">
                                {/* Coverage Amount */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Coverage Amount (ETH)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        value={coverageEth}
                                        onChange={(e) => setCoverageEth(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder="1.0"
                                    />
                                </div>

                                {/* Tier Selection */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Policy Tier
                                    </label>
                                    <select
                                        value={tier}
                                        onChange={(e) => setTier(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    >
                                        {Object.entries(POLICY_TIERS).map(([key, { label }]) => (
                                            <option key={key} value={key}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Duration */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Duration (Days)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={durationDays}
                                        onChange={(e) => setDurationDays(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder="365"
                                    />
                                </div>

                                {/* Premium Calculation */}
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <h3 className="font-semibold text-blue-900 mb-2">💰 Premium Calculation</h3>
                                    <div className="space-y-1 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-blue-700">Coverage:</span>
                                            <span className="font-mono text-blue-900">{coverageEth} ETH</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-blue-700">Rate ({tier}):</span>
                                            <span className="font-mono text-blue-900">
                                                {(POLICY_TIERS[tier].rate * 100).toFixed(0)}%
                                            </span>
                                        </div>
                                        <div className="flex justify-between font-semibold text-lg pt-2 border-t border-blue-300">
                                            <span className="text-blue-900">Premium to Pay:</span>
                                            <span className="font-mono text-blue-900">{premium.toFixed(4)} ETH</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Submit Button */}
                                <button
                                    onClick={handleRequestPolicy}
                                    disabled={requesting || !verifiedKyc}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {requesting ? 'Processing...' : `Request Policy (Pay ${premium.toFixed(4)} ETH)`}
                                </button>

                                <p className="text-xs text-gray-500 text-center">
                                    Premium will be held in escrow until insurer approves your policy.
                                    If rejected, you'll receive an automatic refund.
                                </p>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
