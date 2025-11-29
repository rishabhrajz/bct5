import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { WalletConnect } from '../components/WalletConnect';
import { useWallet } from '../hooks/useWallet';
import { getProviderAndSigner, getContracts, parseEth, formatEth } from '../utils/contracts';

const API_BASE = 'http://localhost:4000';

export default function InsurerDashboard() {
    const { account, isConnected } = useWallet();
    const queryClient = useQueryClient();
    const [payoutAmount, setPayoutAmount] = useState('');
    const [selectedClaim, setSelectedClaim] = useState(null);
    const [rejectionReason, setRejectionReason] = useState('');

    // Fetch statistics
    const { data: pendingProviders } = useQuery({
        queryKey: ['pending-providers'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/provider/pending`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.providers;
        },
        refetchInterval: 10000,
    });

    const { data: pendingPolicies } = useQuery({
        queryKey: ['pending-policies'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/policy/pending`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.policies;
        },
        refetchInterval: 10000,
    });

    const { data: pendingClaims } = useQuery({
        queryKey: ['pending-claims'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/claim/pending`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.claims;
        },
        refetchInterval: 10000,
    });

    const { data: underReviewClaims } = useQuery({
        queryKey: ['under-review-claims'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/claim/under-review`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.claims;
        },
        refetchInterval: 10000,
    });

    // Fetch pending KYC documents
    const { data: pendingKyc } = useQuery({
        queryKey: ['pending-kyc'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/kyc/pending/list`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.documents;
        },
        refetchInterval: 10000,
    });

    // Fetch all active policies
    const { data: activePolicies } = useQuery({
        queryKey: ['active-policies'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/policy/list`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.policies.filter(p => p.status === 'ACTIVE');
        },
        refetchInterval: 10000,
    });

    // KYC approve mutation
    const approveKycMutation = useMutation({
        mutationFn: async (kycId) => {
            const res = await fetch(`${API_BASE}/kyc/verify/${kycId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ verifierAddress: account }),
            });
            if (!res.ok) throw new Error('Failed to approve KYC');
            return res.json();
        },
        onSuccess: () => {
            toast.success('✅ KYC verified!');
            queryClient.invalidateQueries({ queryKey: ['pending-kyc'] });
        },
        onError: (error) => {
            toast.error(`Failed to approve: ${error.message}`);
        },
    });

    // KYC reject mutation
    const rejectKycMutation = useMutation({
        mutationFn: async ({ kycId, reason }) => {
            const res = await fetch(`${API_BASE}/kyc/reject/${kycId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason, verifierAddress: account }),
            });
            if (!res.ok) throw new Error('Failed to reject KYC');
            return res.json();
        },
        onSuccess: () => {
            toast.success('KYC rejected');
            queryClient.invalidateQueries({ queryKey: ['pending-kyc'] });
        },
        onError: (error) => {
            toast.error(`Failed to reject: ${error.message}`);
        },
    });

    // Mutation for setting claim under review
    const setReviewMutation = useMutation({
        mutationFn: async (claimId) => {
            const res = await fetch(`${API_BASE}/claim/under-review/${claimId}`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error('Failed to set under review');
            return res.json();
        },
        onSuccess: () => {
            toast.success('Claim moved to under review');
            queryClient.invalidateQueries({ queryKey: ['pending-claims'] });
            queryClient.invalidateQueries({ queryKey: ['under-review-claims'] });
        },
    });

    // Mutation for approving and paying claim
    const approveAndPayMutation = useMutation({
        mutationFn: async ({ claimId, amount, providerWallet }) => {
            // First approve in backend
            const res = await fetch(`${API_BASE}/claim/approve/${claimId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payoutAmount: amount }),
            });
            if (!res.ok) throw new Error('Backend approval failed');

            // Then pay on-chain
            const { signer } = await getProviderAndSigner();
            const { claimContract } = getContracts(signer);

            const tx = await claimContract.approveAndPayClaim(claimId, parseEth(amount), {
                value: parseEth(amount),
            });

            const receipt = await tx.wait();

            // Mark as paid in backend
            await fetch(`${API_BASE}/claim/mark-paid/${claimId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txHash: receipt.hash }),
            });

            return receipt;
        },
        onSuccess: () => {
            toast.success('✅ Claim approved and paid!');
            setSelectedClaim(null);
            setPayoutAmount('');
            queryClient.invalidateQueries({ queryKey: ['under-review-claims'] });
        },
        onError: (error) => {
            toast.error(`Payment failed: ${error.message}`);
        },
    });

    // Mutation for rejecting claim
    const rejectMutation = useMutation({
        mutationFn: async ({ claimId, reason }) => {
            const res = await fetch(`${API_BASE}/claim/reject/${claimId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason }),
            });
            if (!res.ok) throw new Error('Rejection failed');
            return res.json();
        },
        onSuccess: () => {
            toast.success('Claim rejected');
            setSelectedClaim(null);
            setRejectionReason('');
            queryClient.invalidateQueries({ queryKey: ['pending-claims'] });
            queryClient.invalidateQueries({ queryKey: ['under-review-claims'] });
        },
    });

    const handleApproveAndPay = async (claim) => {
        if (!payoutAmount || parseFloat(payoutAmount) <= 0) {
            toast.error('Please enter valid payout amount');
            return;
        }

        approveAndPayMutation.mutate({
            claimId: claim.id,
            amount: payoutAmount,
            providerWallet: claim.providerWallet || claim.providerAddress,
        });
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
                <h1 className="text-3xl font-bold mb-2">🏛️ Insurer Dashboard</h1>
                <p className="text-gray-600">Manage approvals and claims</p>
            </div>

            <WalletConnect />

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Link
                    to="/insurer/provider-approvals"
                    className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
                >
                    <h3 className="text-sm font-semibold text-gray-600 mb-2">Pending Providers</h3>
                    <p className="text-3xl font-bold text-blue-600">
                        {pendingProviders?.length || 0}
                    </p>
                </Link>

                <Link
                    to="/insurer/policy-approvals"
                    className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
                >
                    <h3 className="text-sm font-semibold text-gray-600 mb-2">Pending Policies</h3>
                    <p className="text-3xl font-bold text-green-600">
                        {pendingPolicies?.length || 0}
                    </p>
                </Link>

                <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-sm font-semibold text-gray-600 mb-2">Pending KYC</h3>
                    <p className="text-3xl font-bold text-purple-600">
                        {pendingKyc?.length || 0}
                    </p>
                </div>

                <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-sm font-semibold text-gray-600 mb-2">Pending Claims</h3>
                    <p className="text-3xl font-bold text-orange-600">
                        {(pendingClaims?.length || 0) + (underReviewClaims?.length || 0)}
                    </p>
                </div>
            </div>

            {/* Pending KYC Approvals */}
            {isConnected && pendingKyc && pendingKyc.length > 0 && (
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold mb-4">📄 Pending KYC Verifications</h2>
                    <div className="space-y-4">
                        {pendingKyc.map((kyc) => (
                            <div key={kyc.id} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <h3 className="font-semibold">KYC Document #{kyc.id}</h3>
                                        <p className="text-sm text-gray-600">
                                            User: <code className="bg-gray-100 px-2 py-1 rounded text-xs">{kyc.userAddress}</code>
                                        </p>
                                        <p className="text-sm text-gray-600">
                                            Type: {kyc.documentType}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            Submitted: {new Date(kyc.createdAt).toLocaleString()}
                                        </p>
                                        {kyc.documentCid && (
                                            <a
                                                href={`https://gateway.pinata.cloud/ipfs/${kyc.documentCid}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:underline text-sm mt-2 inline-block"
                                            >
                                                📄 View Document
                                            </a>
                                        )}
                                    </div>
                                    <div className="flex gap-2 ml-4">
                                        <button
                                            onClick={() => approveKycMutation.mutate(kyc.id)}
                                            disabled={approveKycMutation.isPending}
                                            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
                                        >
                                            ✅ Verify
                                        </button>
                                        <button
                                            onClick={() => {
                                                const reason = prompt('Enter rejection reason:');
                                                if (reason) {
                                                    rejectKycMutation.mutate({ kycId: kyc.id, reason });
                                                }
                                            }}
                                            disabled={rejectKycMutation.isPending}
                                            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
                                        >
                                            ❌ Reject
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Active Policies */}
            {isConnected && activePolicies && activePolicies.length > 0 && (
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold mb-4">✅ Active Policies ({activePolicies.length})</h2>
                    <div className="space-y-3">
                        {activePolicies.map((policy) => (
                            <div key={policy.id} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <h3 className="font-semibold">Policy #{policy.onchainPolicyId}</h3>
                                        <div className="text-sm text-gray-600 space-y-1 mt-2">
                                            <p>
                                                <span className="font-medium">Patient:</span>{' '}
                                                <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">
                                                    {policy.beneficiaryAddress}
                                                </code>
                                            </p>
                                            <p>
                                                <span className="font-medium">Coverage:</span>{' '}
                                                {(parseInt(policy.coverageAmount) / 1e18).toFixed(2)} ETH
                                            </p>
                                            <p>
                                                <span className="font-medium">Tier:</span> {policy.tier}
                                            </p>
                                            <p>
                                                <span className="font-medium">Premium Paid:</span>{' '}
                                                {policy.premiumPaid ? (parseInt(policy.premiumPaid) / 1e18).toFixed(4) : '0'} ETH
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                Activated: {new Date(policy.approvedAt || policy.createdAt).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                                        Active
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Pending Claims */}
            {isConnected && pendingClaims && pendingClaims.length > 0 && (
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold mb-4">📋 Pending Claims</h2>
                    <div className="space-y-4">
                        {pendingClaims.map((claim) => (
                            <div key={claim.id} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="font-semibold">Claim #{claim.id}</h3>
                                        <p className="text-sm text-gray-600">
                                            Amount: {(parseInt(claim.amount) / 1e18).toFixed(4)} ETH
                                        </p>
                                        <p className="text-sm text-gray-600">Policy: #{claim.policyId}</p>
                                    </div>
                                    <button
                                        onClick={() => setReviewMutation.mutate(claim.id)}
                                        disabled={setReviewMutation.isPending}
                                        className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
                                    >
                                        🔍 Review
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Under Review Claims */}
            {isConnected && underReviewClaims && underReviewClaims.length > 0 && (
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold mb-4">👀 Claims Under Review</h2>
                    <div className="space-y-4">
                        {underReviewClaims.map((claim) => (
                            <div key={claim.id} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <h3 className="font-semibold text-lg">Claim #{claim.id}</h3>
                                        <p className="text-sm text-gray-600">
                                            Requested: {(parseInt(claim.amount) / 1e18).toFixed(4)} ETH
                                        </p>
                                        <p className="text-sm text-gray-600">
                                            Provider: {claim.providerAddress?.slice(0, 10)}...
                                        </p>
                                        {claim.medicalReportCid && (
                                            <a
                                                href={`https://gateway.pinata.cloud/ipfs/${claim.medicalReportCid}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:underline text-sm"
                                            >
                                                📄 View Medical Report
                                            </a>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setSelectedClaim({ ...claim, action: 'approve' })}
                                            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm"
                                        >
                                            ✅ Approve & Pay
                                        </button>
                                        <button
                                            onClick={() => setSelectedClaim({ ...claim, action: 'reject' })}
                                            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm"
                                        >
                                            ❌ Reject
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Approve & Pay Modal */}
            {selectedClaim?.action === 'approve' && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full">
                        <h3 className="text-lg font-semibold mb-4">
                            Approve & Pay Claim #{selectedClaim.id}
                        </h3>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Payout Amount (ETH)
                            </label>
                            <input
                                type="number"
                                step="0.0001"
                                value={payoutAmount}
                                onChange={(e) => setPayoutAmount(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                placeholder={`Max: ${(parseInt(selectedClaim.amount) / 1e18).toFixed(4)}`}
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Requested: {(parseInt(selectedClaim.amount) / 1e18).toFixed(4)} ETH
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => handleApproveAndPay(selectedClaim)}
                                disabled={approveAndPayMutation.isPending}
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded font-medium disabled:opacity-50"
                            >
                                {approveAndPayMutation.isPending ? 'Processing...' : 'Approve & Pay'}
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedClaim(null);
                                    setPayoutAmount('');
                                }}
                                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-2 rounded font-medium"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reject Modal */}
            {selectedClaim?.action === 'reject' && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full">
                        <h3 className="text-lg font-semibold mb-4">
                            Reject Claim #{selectedClaim.id}
                        </h3>
                        <textarea
                            className="w-full border border-gray-300 rounded p-3 mb-4"
                            rows="4"
                            placeholder="Enter rejection reason..."
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                        />
                        <div className="flex gap-3">
                            <button
                                onClick={() => rejectMutation.mutate({
                                    claimId: selectedClaim.id,
                                    reason: rejectionReason,
                                })}
                                disabled={rejectMutation.isPending || !rejectionReason.trim()}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded font-medium disabled:opacity-50"
                            >
                                Confirm Rejection
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedClaim(null);
                                    setRejectionReason('');
                                }}
                                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-2 rounded font-medium"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
