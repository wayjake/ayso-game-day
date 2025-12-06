import { useState, useRef, useCallback, useEffect } from 'react';
import { useFetcher } from 'react-router';
import { getAcceptString } from '~/api/roster-import/validation';

interface RosterImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: number;
  existingPlayers: Array<{ id: number; name: string }>;
  onImportComplete: (result: ImportResult) => void;
}

interface ExtractedPlayer {
  tempId: string;
  name: string;
  jerseyNumber?: number;
  preferredPositions?: string[];
  notes?: string;
  confidence: number;
}

interface MatchResult {
  tempId: string;
  extractedName: string;
  matchType: 'exact' | 'fuzzy' | 'new';
  existingPlayerId?: number;
  existingPlayerName?: string;
  similarityScore?: number;
}

interface ImportablePlayer extends ExtractedPlayer {
  matchType: 'exact' | 'fuzzy' | 'new';
  existingPlayerId?: number;
  existingPlayerName?: string;
  action: 'create' | 'update' | 'skip';
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

interface ExtractResponse {
  success: boolean;
  extractedPlayers?: ExtractedPlayer[];
  matchResults?: MatchResult[];
  extractionNotes?: string;
  error?: string;
}

interface ImportResponse {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors?: string[];
}

type Step = 'upload' | 'review' | 'confirm' | 'complete';

export function RosterImportModal({
  isOpen,
  onClose,
  teamId,
  onImportComplete,
}: RosterImportModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [players, setPlayers] = useState<ImportablePlayer[]>([]);
  const [extractionNotes, setExtractionNotes] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractFetcher = useFetcher<ExtractResponse>();
  const importFetcher = useFetcher<ImportResponse>();

  const isExtracting = extractFetcher.state !== 'idle';
  const isImporting = importFetcher.state !== 'idle';

  // Reset state when modal opens/closes
  const handleClose = () => {
    setStep('upload');
    setFile(null);
    setPlayers([]);
    setExtractionNotes(null);
    setImportResult(null);
    setError(null);
    onClose();
  };

  // Handle file selection
  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
  };

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Handle extraction
  const handleExtract = () => {
    if (!file) return;

    setError(null);
    const formData = new FormData();
    formData.append('_action', 'extract');
    formData.append('file', file);
    formData.append('teamId', teamId.toString());

    extractFetcher.submit(formData, {
      method: 'post',
      action: '/api/roster-import',
      encType: 'multipart/form-data',
    });
  };

  // Process extract response
  useEffect(() => {
    if (extractFetcher.data && step === 'upload' && extractFetcher.state === 'idle') {
      const response = extractFetcher.data;
      if (response.success && response.extractedPlayers && response.matchResults) {
        // Combine extracted players with match results
        const importablePlayers: ImportablePlayer[] = response.extractedPlayers.map((player) => {
          const match = response.matchResults!.find((m) => m.tempId === player.tempId);
          const matchType = match?.matchType || 'new';

          // Default action based on match type
          let action: 'create' | 'update' | 'skip' = 'create';
          if (matchType === 'exact') {
            action = 'update';
          } else if (matchType === 'fuzzy') {
            action = 'update'; // Default to update for fuzzy, user can change
          }

          return {
            ...player,
            matchType,
            existingPlayerId: match?.existingPlayerId,
            existingPlayerName: match?.existingPlayerName,
            action,
          };
        });

        setPlayers(importablePlayers);
        setExtractionNotes(response.extractionNotes || null);
        setStep('review');
      } else if (response.error) {
        setError(response.error);
      }
    }
  }, [extractFetcher.data, extractFetcher.state, step]);

  // Handle import
  const handleImport = () => {
    const importData = players.map((p) => ({
      tempId: p.tempId,
      name: p.name,
      jerseyNumber: p.jerseyNumber,
      preferredPositions: p.preferredPositions,
      notes: p.notes,
      action: p.action,
      existingPlayerId: p.existingPlayerId,
    }));

    const formData = new FormData();
    formData.append('_action', 'import');
    formData.append('teamId', teamId.toString());
    formData.append('players', JSON.stringify(importData));

    importFetcher.submit(formData, {
      method: 'post',
      action: '/api/roster-import',
    });
  };

  // Process import response
  useEffect(() => {
    if (importFetcher.data && step === 'confirm' && importFetcher.state === 'idle') {
      const response = importFetcher.data;
      if (response.success || (response.created > 0 || response.updated > 0)) {
        const result = {
          created: response.created,
          updated: response.updated,
          skipped: response.skipped,
        };
        setImportResult(result);
        setStep('complete');
        onImportComplete(result);
      } else if (response.errors?.length) {
        setError(response.errors.join(', '));
      }
    }
  }, [importFetcher.data, importFetcher.state, step, onImportComplete]);

  // Update player action
  const updatePlayerAction = (tempId: string, action: 'create' | 'update' | 'skip') => {
    setPlayers((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, action } : p))
    );
  };

  // Update player name
  const updatePlayerName = (tempId: string, name: string) => {
    setPlayers((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, name } : p))
    );
  };

  // Calculate summary
  const summary = {
    create: players.filter((p) => p.action === 'create').length,
    update: players.filter((p) => p.action === 'update').length,
    skip: players.filter((p) => p.action === 'skip').length,
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--surface)] rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-xl font-semibold">Import Roster</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-[var(--bg)] transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-[var(--muted)]">
                Upload an image, PDF, or text file containing your roster. Our AI will extract player names, jersey numbers, and positions.
              </p>

              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition
                  ${file ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] hover:border-[var(--primary)]/50'}
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={getAcceptString()}
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                {file ? (
                  <div className="space-y-2">
                    <div className="text-4xl">📄</div>
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-[var(--muted)]">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                      className="text-sm text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-4xl">📁</div>
                    <p className="font-medium">Drop a file here or click to browse</p>
                    <p className="text-sm text-[var(--muted)]">
                      Supports images, PDFs, and CSV/text files
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Review */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[var(--muted)]">
                  Review extracted players and confirm actions.
                </p>
                <div className="flex gap-2 text-sm">
                  <span className="px-2 py-1 rounded bg-green-100 text-green-700">
                    {summary.create} new
                  </span>
                  <span className="px-2 py-1 rounded bg-blue-100 text-blue-700">
                    {summary.update} update
                  </span>
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">
                    {summary.skip} skip
                  </span>
                </div>
              </div>

              {extractionNotes && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
                  <strong>AI Notes:</strong> {extractionNotes}
                </div>
              )}

              {/* Players table */}
              <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg)]">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Player Name</th>
                      <th className="text-left px-4 py-2 font-medium">Match</th>
                      <th className="text-left px-4 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {players.map((player) => (
                      <tr key={player.tempId} className="hover:bg-[var(--bg)]/50">
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={player.name}
                            onChange={(e) => updatePlayerName(player.tempId, e.target.value)}
                            className="w-full px-2 py-1 border border-[var(--border)] rounded bg-transparent"
                          />
                          {player.jerseyNumber && (
                            <span className="ml-2 text-xs text-[var(--muted)]">
                              #{player.jerseyNumber}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {player.matchType === 'exact' && (
                            <span className="inline-flex items-center gap-1 text-green-600">
                              <span className="w-2 h-2 rounded-full bg-green-500" />
                              Exact: {player.existingPlayerName}
                            </span>
                          )}
                          {player.matchType === 'fuzzy' && (
                            <span className="inline-flex items-center gap-1 text-amber-600">
                              <span className="w-2 h-2 rounded-full bg-amber-500" />
                              Similar: {player.existingPlayerName}
                            </span>
                          )}
                          {player.matchType === 'new' && (
                            <span className="inline-flex items-center gap-1 text-blue-600">
                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                              New player
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={player.action}
                            onChange={(e) =>
                              updatePlayerAction(
                                player.tempId,
                                e.target.value as 'create' | 'update' | 'skip'
                              )
                            }
                            className="px-2 py-1 border border-[var(--border)] rounded bg-transparent"
                          >
                            <option value="create">Create New</option>
                            {player.existingPlayerId && (
                              <option value="update">Update Existing</option>
                            )}
                            <option value="skip">Skip</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <p className="text-[var(--muted)]">
                Confirm the following changes to your roster:
              </p>

              <div className="p-4 rounded-lg bg-[var(--bg)] space-y-2">
                {summary.create > 0 && (
                  <p className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <strong>{summary.create}</strong> new players will be created
                  </p>
                )}
                {summary.update > 0 && (
                  <p className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <strong>{summary.update}</strong> existing players will be updated
                  </p>
                )}
                {summary.skip > 0 && (
                  <p className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <strong>{summary.skip}</strong> players will be skipped
                  </p>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 'complete' && importResult && (
            <div className="text-center space-y-4 py-8">
              <div className="text-5xl">✅</div>
              <h3 className="text-xl font-semibold">Import Complete!</h3>
              <div className="text-[var(--muted)] space-y-1">
                {importResult.created > 0 && (
                  <p>{importResult.created} players created</p>
                )}
                {importResult.updated > 0 && (
                  <p>{importResult.updated} players updated</p>
                )}
                {importResult.skipped > 0 && (
                  <p>{importResult.skipped} players skipped</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] bg-[var(--bg)]">
          {step === 'upload' && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded font-medium text-[var(--muted)] hover:text-[var(--text)] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleExtract}
                disabled={!file || isExtracting}
                className="px-4 py-2 rounded font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isExtracting ? 'Extracting...' : 'Extract Players'}
              </button>
            </>
          )}

          {step === 'review' && (
            <>
              <button
                onClick={() => setStep('upload')}
                className="px-4 py-2 rounded font-medium text-[var(--muted)] hover:text-[var(--text)] transition"
              >
                Back
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={summary.create + summary.update === 0}
                className="px-4 py-2 rounded font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Continue
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button
                onClick={() => setStep('review')}
                disabled={isImporting}
                className="px-4 py-2 rounded font-medium text-[var(--muted)] hover:text-[var(--text)] transition"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="px-4 py-2 rounded font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isImporting ? 'Importing...' : 'Import Players'}
              </button>
            </>
          )}

          {step === 'complete' && (
            <button
              onClick={handleClose}
              className="ml-auto px-4 py-2 rounded font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] transition"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
