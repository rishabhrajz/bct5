import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

const API_BASE = 'http://localhost:4000';

export default function AdminReconcile() {
    const [selectedMismatch, setSelectedMismatch] = useState(null);
    const [filterType, setFilterType] = useState('all');
    const [showConfirmModal, setShowConfirmModal] = useState(null);
    const queryClient = useQueryClient();

    // Fetch reconciler status
    const { data: status } = useQuery({
        queryKey: ['reconciler-status'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/api/reconcile/status`);
            return res.json();
        },
        refetchInterval: 5000 // Refresh every 5 seconds
    });

    // Fetch mismatches
    const { data: mismatchesData, isLoading } = useQuery({
        queryKey: ['mismatches'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/api/reconcile/mismatches`);
            return res.json();
        },
        refetchInterval: 10000
    });

    // Fetch suggestions
    const { data: suggestionsData } = useQuery({
        queryKey: ['suggestions'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/api/reconcile/suggestions`);
            return res.json();
        }
    });

    // Run reconciliation
    const runReconcileMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(`${API_BASE}/api/reconcile/run`, {
                method: 'POST'
            });
            return res.json();
        },
        onSuccess: () => {
            toast.success('Reconciliation completed!');
            queryClient.invalidateQueries(['mismatches']);
            queryClient.invalidateQueries(['suggestions']);
            queryClient.invalidateQueries(['reconciler-status']);
        },
        onError: (error) => {
            toast.error(`Reconciliation failed: ${error.message}`);
        }
    });

    // Apply suggestion
    const applyMutation = useMutation({
        mutationFn: async ({ suggestionId, adminAddress }) => {
            const res = await fetch(`${API_BASE}/api/reconcile/apply/${suggestionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminAddress })
            });
            if (!res.ok) throw new Error('Failed to apply suggestion');
            return res.json();
        },
        onSuccess: () => {
            toast.success('Fix applied successfully!');
            queryClient.invalidateQueries(['mismatches']);
            queryClient.invalidateQueries(['suggestions']);
            setShowConfirmModal(null);
            setSelectedMismatch(null);
        },
        onError: (error) => {
            toast.error(`Failed to apply fix: ${error.message}`);
        }
    });

    const mismatches = mismatchesData?.mismatches || [];
    const suggestions = suggestionsData?.suggestions || [];

    const filteredMismatches = filterType === 'all'
        ? mismatches
        : mismatches.filter(m => m.entityType === filterType);

    const handleApplyFix = (suggestion) => {
        setShowConfirmModal(suggestion);
    };

    const confirmApply = () => {
        if (showConfirmModal) {
            // Find the suggestion ID from the mismatch
            const suggestion = suggestions.find(
                s => s.entityType === showConfirmModal.entityType &&
                    s.entityId === showConfirmModal.entityId
            );
            if (suggestion) {
                applyMutation.mutate({
                    suggestionId: suggestion.id,
                    adminAddress: 'admin'
                });
            }
        }
    };

    return (
        <div className="max-w-7xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">🔄 Reconciliation Dashboard</h1>
                    <p className="text-gray-600 mt-1">Monitor and resolve blockchain-database mismatches</p>
                </div>
                <button
                    onClick={() => runReconcileMutation.mutate()}
                    disabled={runReconcileMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {runReconcileMutation.isPending ? '⏳ Running...' : '▶️ Run Reconcile Now'}
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow p-6">
                    <div className="text-sm text-gray-600 mb-1">Total Reconciled</div>
                    <div className="text-3xl font-bold text-blue-600">{status?.stats?.totalReconciled || 0}</div>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <div className="text-sm text-gray-600 mb-1">Auto-Fixed</div>
                    <div className="text-3xl font-bold text-green-600">{status?.stats?.autoFixed || 0}</div>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <div className="text-sm text-gray-600 mb-1">Pending Suggestions</div>
                    <div className="text-3xl font-bold text-orange-600">{mismatches.length}</div>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                    <div className="text-sm text-gray-600 mb-1">Last Run</div>
                    <div className="text-sm font-medium text-gray-900">
                        {status?.lastRun ? new Date(status.lastRun).toLocaleTimeString() : 'Never'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        {status?.autoFixEnabled ? '✅ Auto-fix ON' : '⚠️ Auto-fix OFF'}
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg shadow p-4">
                <div className="flex gap-2">
                    <button
                        onClick={() => setFilterType('all')}
                        className={`px-4 py-2 rounded ${filterType === 'all'
                                ? 'bg-blue-100 text-blue-700 font-semibold'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        All ({mismatches.length})
                    </button>
                    <button
                        onClick={() => setFilterType('policy')}
                        className={`px-4 py-2 rounded ${filterType === 'policy'
                                ? 'bg-blue-100 text-blue-700 font-semibold'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        Policies ({mismatches.filter(m => m.entityType === 'policy').length})
                    </button>
                    <button
                        onClick={() => setFilterType('claim')}
                        className={`px-4 py-2 rounded ${filterType === 'claim'
                                ? 'bg-blue-100 text-blue-700 font-semibold'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        Claims ({mismatches.filter(m => m.entityType === 'claim').length})
                    </button>
                </div>
            </div>

            {/* Mismatches Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-xl font-bold">Detected Mismatches</h2>
                </div>

                {isLoading ? (
                    <div className="p-12 text-center text-gray-500">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        Loading mismatches...
                    </div>
                ) : filteredMismatches.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="text-6xl mb-4">✅</div>
                        <div className="text-xl font-semibold text-gray-700">No Mismatches Detected</div>
                        <div className="text-gray-500 mt-2">Database is in sync with blockchain</div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Field</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">DB Value</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chain Value</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredMismatches.map((mismatch, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">
                                                {mismatch.entityType.toUpperCase()} #{mismatch.entityId}
                                            </div>
                                            <div className="text-xs text-gray-500">{mismatch.id}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {mismatch.field}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="px-2 py-1 text-xs font-semibold rounded bg-red-100 text-red-800">
                                                {mismatch.dbValue}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">
                                                {mismatch.chainValue}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded ${mismatch.severity === 'critical'
                                                    ? 'bg-red-100 text-red-800'
                                                    : 'bg-orange-100 text-orange-800'
                                                }`}>
                                                {mismatch.severity}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                                            <button
                                                onClick={() => setSelectedMismatch(mismatch)}
                                                className="text-blue-600 hover:text-blue-800 font-medium"
                                            >
                                                View
                                            </button>
                                            {mismatch.severity !== 'critical' && (
                                                <button
                                                    onClick={() => handleApplyFix(mismatch)}
                                                    className="text-green-600 hover:text-green-800 font-medium"
                                                >
                                                    Apply Fix
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Detail Drawer */}
            {selectedMismatch && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
                            <h3 className="text-xl font-bold">Mismatch Details</h3>
                            <button
                                onClick={() => setSelectedMismatch(null)}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ×
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* Summary */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="text-sm text-gray-600">Entity</div>
                                        <div className="font-semibold">{selectedMismatch.entityType.toUpperCase()} #{selectedMismatch.entityId}</div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-600">Field</div>
                                        <div className="font-semibold">{selectedMismatch.field}</div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-600">Severity</div>
                                        <span className={`px-2 py-1 text-xs font-semibold rounded ${selectedMismatch.severity === 'critical'
                                                ? 'bg-red-100 text-red-800'
                                                : 'bg-orange-100 text-orange-800'
                                            }`}>
                                            {selectedMismatch.severity}
                                        </span>
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-600">Detected At</div>
                                        <div className="text-sm">{new Date(selectedMismatch.detectedAt).toLocaleString()}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Comparison */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="border border-red-200 rounded-lg p-4">
                                    <div className="text-sm font-semibold text-red-700 mb-2">Database Value</div>
                                    <pre className="text-sm bg-red-50 p-2 rounded overflow-x-auto">
                                        {selectedMismatch.dbValue}
                                    </pre>
                                </div>
                                <div className="border border-green-200 rounded-lg p-4">
                                    <div className="text-sm font-semibold text-green-700 mb-2">Blockchain Value</div>
                                    <pre className="text-sm bg-green-50 p-2 rounded overflow-x-auto">
                                        {selectedMismatch.chainValue}
                                    </pre>
                                </div>
                            </div>

                            {/* Reason */}
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <div className="text-sm font-semibold text-blue-700 mb-2">Reason</div>
                                <div className="text-sm text-blue-900">{selectedMismatch.reason}</div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 pt-4">
                                {selectedMismatch.severity !== 'critical' ? (
                                    <button
                                        onClick={() => handleApplyFix(selectedMismatch)}
                                        className="flex-1 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold"
                                    >
                                        Apply Suggested Fix
                                    </button>
                                ) : (
                                    <div className="flex-1 bg-red-100 border border-red-200 text-red-800 px-6 py-3 rounded-lg text-center">
                                        ⚠️ Critical mismatch - Manual review required
                                    </div>
                                )}
                                <button
                                    onClick={() => setSelectedMismatch(null)}
                                    className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Modal */}
            {showConfirmModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg max-w-md w-full p-6">
                        <h3 className="text-xl font-bold mb-4">Confirm Fix Application</h3>
                        <p className="text-gray-700 mb-6">
                            This will update the database to match the blockchain state. Are you sure?
                        </p>
                        <div className="bg-gray-50 rounded p-4 mb-6 text-sm">
                            <div className="font-semibold mb-2">Change:</div>
                            <div className="text-red-600">- {showConfirmModal.field}: {showConfirmModal.dbValue}</div>
                            <div className="text-green-600">+ {showConfirmModal.field}: {showConfirmModal.chainValue}</div>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={confirmApply}
                                disabled={applyMutation.isPending}
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50"
                            >
                                {applyMutation.isPending ? 'Applying...' : 'Confirm'}
                            </button>
                            <button
                                onClick={() => setShowConfirmModal(null)}
                                className="flex-1 border border-gray-300 rounded-lg hover:bg-gray-50"
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
