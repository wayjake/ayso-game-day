import { useState, useRef, useCallback, useEffect } from 'react';
import { useFetcher } from 'react-router';
import { getAcceptString } from '~/api/roster-import/validation';
import { Alert, Badge, Button, cx, inputClass } from '~/components/ui';
import { CheckCircle, CircleNotch, FileText, Sparkle, UploadSimple, X } from '@phosphor-icons/react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="roster-import-title"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface shadow-overlay"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <h2 id="roster-import-title" className="text-lg font-semibold">
            Import roster
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Upload a photo, PDF, or text file of your roster. AI pulls out player names, jersey numbers, and positions for you to review.
              </p>

              {/* Drop zone */}
              <div
                onDrop={isExtracting ? undefined : handleDrop}
                onDragOver={isExtracting ? undefined : handleDragOver}
                onClick={isExtracting ? undefined : () => fileInputRef.current?.click()}
                className={cx(
                  "rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
                  isExtracting ? "cursor-default opacity-60" : "cursor-pointer",
                  file ? "border-primary bg-primary-soft/60" : "border-line-strong hover:border-primary/50 hover:bg-surface-2"
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={getAcceptString()}
                  onChange={handleFileInputChange}
                  className="hidden"
                  disabled={isExtracting}
                />

                {file ? (
                  <div className="flex flex-col items-center gap-1">
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-primary shadow-card">
                      {isExtracting ? <CircleNotch size={24} className="animate-spin" /> : <FileText size={24} />}
                    </div>
                    <p className="max-w-full truncate font-semibold">{file.name}</p>
                    <p className="text-sm text-muted tabular">
                      {isExtracting ? 'Extracting player data...' : `${(file.size / 1024).toFixed(1)} KB`}
                    </p>
                    {!isExtracting && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                        }}
                        className="mt-1 rounded px-2 py-1 text-sm font-medium text-danger hover:bg-danger-soft"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <UploadSimple size={24} />
                    </div>
                    <p className="font-semibold">Drop a file here or click to browse</p>
                    <p className="text-sm text-muted">
                      Images, PDFs, and CSV or text files
                    </p>
                  </div>
                )}
              </div>

              {error && <Alert>{error}</Alert>}
            </div>
          )}

          {/* Step 2: Review */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">
                  Check each player and choose what to do with them.
                </p>
                <div className="flex gap-1.5">
                  <Badge tone="success">{summary.create} new</Badge>
                  <Badge tone="primary">{summary.update} update</Badge>
                  <Badge>{summary.skip} skip</Badge>
                </div>
              </div>

              {extractionNotes && (
                <Alert tone="warning" className="flex gap-2">
                  <Sparkle size={18} className="mt-px shrink-0" />
                  <span>
                    <strong className="font-semibold">AI notes:</strong> {extractionNotes}
                  </span>
                </Alert>
              )}

              {/* Players list */}
              <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
                {players.map((player) => (
                  <li
                    key={player.tempId}
                    className={cx(
                      "grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4",
                      player.action === 'skip' && "bg-surface-2/60"
                    )}
                  >
                    <div className="min-w-0">
                      <input
                        type="text"
                        value={player.name}
                        onChange={(e) => updatePlayerName(player.tempId, e.target.value)}
                        aria-label="Player name"
                        className={inputClass}
                      />
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {player.matchType === 'exact' && (
                          <span className="inline-flex items-center gap-1.5 font-medium text-success">
                            <span className="h-2 w-2 rounded-full bg-success" />
                            Matches {player.existingPlayerName}
                          </span>
                        )}
                        {player.matchType === 'fuzzy' && (
                          <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                            <span className="h-2 w-2 rounded-full bg-warning" />
                            Similar to {player.existingPlayerName}
                          </span>
                        )}
                        {player.matchType === 'new' && (
                          <span className="inline-flex items-center gap-1.5 font-medium text-primary-ink">
                            <span className="h-2 w-2 rounded-full bg-primary" />
                            New player
                          </span>
                        )}
                        {player.jerseyNumber != null && (
                          <span className="text-muted tabular">#{player.jerseyNumber}</span>
                        )}
                      </div>
                    </div>
                    <select
                      value={player.action}
                      onChange={(e) =>
                        updatePlayerAction(
                          player.tempId,
                          e.target.value as 'create' | 'update' | 'skip'
                        )
                      }
                      aria-label={`Action for ${player.name}`}
                      className={cx(inputClass, "sm:w-44 sm:self-start")}
                    >
                      <option value="create">Create new</option>
                      {player.existingPlayerId && (
                        <option value="update">Update existing</option>
                      )}
                      <option value="skip">Skip</option>
                    </select>
                  </li>
                ))}
              </ul>

              {error && <Alert>{error}</Alert>}
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                These changes will be made to your roster:
              </p>

              <ul className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
                {summary.create > 0 && (
                  <li className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span><strong className="tabular">{summary.create}</strong> new players will be created</span>
                  </li>
                )}
                {summary.update > 0 && (
                  <li className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    <span><strong className="tabular">{summary.update}</strong> existing players will be updated</span>
                  </li>
                )}
                {summary.skip > 0 && (
                  <li className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full bg-subtle" />
                    <span><strong className="tabular">{summary.skip}</strong> players will be skipped</span>
                  </li>
                )}
              </ul>

              {error && <Alert>{error}</Alert>}
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 'complete' && importResult && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-success-soft text-success">
                <CheckCircle size={32} weight="fill" />
              </div>
              <h3 className="text-lg font-semibold">Import complete</h3>
              <div className="mt-1 space-y-0.5 text-sm text-muted tabular">
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
        <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2/60 px-5 py-4 sm:px-6">
          {step === 'upload' && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleExtract} disabled={!file || isExtracting}>
                {isExtracting ? (
                  <CircleNotch size={18} className="animate-spin" />
                ) : (
                  <Sparkle size={18} weight="fill" />
                )}
                {isExtracting ? 'Extracting...' : 'Extract players'}
              </Button>
            </>
          )}

          {step === 'review' && (
            <>
              <Button variant="ghost" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button
                onClick={() => setStep('confirm')}
                disabled={summary.create + summary.update === 0}
              >
                Continue
              </Button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <Button variant="ghost" onClick={() => setStep('review')} disabled={isImporting}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting && <CircleNotch size={18} className="animate-spin" />}
                {isImporting ? 'Importing...' : 'Import players'}
              </Button>
            </>
          )}

          {step === 'complete' && (
            <Button onClick={handleClose} className="ml-auto">
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
