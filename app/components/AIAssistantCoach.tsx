import { useState, useEffect, useRef, useCallback } from 'react';
import { useFetcher } from 'react-router';
import { useAudioRecorder } from '~/hooks/useAudioRecorder';
import { ArrowCounterClockwise, Check, Lightbulb, Lock, Microphone, PencilSimple, Sparkle, X } from '@phosphor-icons/react';
import { Alert, Badge, Button, cx, inputClass, labelClass } from '~/components/ui';

interface AIAssistantCoachProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: number;
  teamId: number;
  onAcceptLineup: (quarters: QuarterLineup[]) => void;
}

interface QuarterChange {
  positionNumber: number;
  positionName: string;
  playerId: number;
  playerName: string;
  isChange: boolean;
}

interface Substitute {
  playerId: number;
  playerName: string;
}

interface QuarterLineup {
  number: number;
  completed: boolean;
  players: Record<number, number>; // positionNumber -> playerId
  changes?: QuarterChange[];
  substitutes?: Substitute[];
}

interface AIResponse {
  success: boolean;
  message?: string;
  quarters?: QuarterLineup[];
  error?: string;
}

export function AIAssistantCoach({ isOpen, onClose, gameId, teamId, onAcceptLineup }: AIAssistantCoachProps) {
  const [textInput, setTextInput] = useState('');
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [suggestedQuarters, setSuggestedQuarters] = useState<QuarterLineup[] | null>(null);
  const [previousMessage, setPreviousMessage] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isSuggestingChanges, setIsSuggestingChanges] = useState(false);

  const fetcher = useFetcher<AIResponse>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    isRecording,
    audioBlob,
    startRecording,
    stopRecording,
    resetRecording,
    error: recordingError,
  } = useAudioRecorder();

  // Define handleGenerateLineup - Single request approach
  const handleGenerateLineup = useCallback((input: string) => {
    // Clear current suggestions while loading
    setAiMessage(null);
    setSuggestedQuarters(null);

    const formData = new FormData();
    formData.append('_action', 'generate');
    formData.append('gameId', gameId.toString());
    formData.append('teamId', teamId.toString());
    formData.append('userInput', input);

    fetcher.submit(formData, {
      method: 'post',
      action: '/api/ai-lineup',
    });
  }, [gameId, teamId, fetcher]);

  // Handle recording button - start on mouse down, stop on mouse up
  const handleRecordButtonDown = () => {
    startRecording();
  };

  const handleRecordButtonUp = () => {
    stopRecording();
  };

  // Handle audio upload and transcription
  useEffect(() => {
    if (audioBlob && !isRecording) {
      const formData = new FormData();
      formData.append('_action', 'transcribe');
      formData.append('audio', audioBlob, 'recording.webm');

      fetcher.submit(formData, {
        method: 'post',
        action: '/api/ai-lineup',
        encType: 'multipart/form-data',
      });

      resetRecording();
    }
  }, [audioBlob, isRecording, fetcher, resetRecording]);

  // Handle transcription response
  useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') {
      if ('text' in fetcher.data && fetcher.data.text) {
        // Transcription completed, now generate lineup
        setTextInput(fetcher.data.text as string);
        handleGenerateLineup(fetcher.data.text as string);
      } else if ('message' in fetcher.data && fetcher.data.message) {
        // Lineup generation completed
        setAiMessage(fetcher.data.message);
        setSuggestedQuarters(fetcher.data.quarters || null);
      }
    }
  }, [fetcher.data, fetcher.state, handleGenerateLineup]);

  const handleTextSubmit = () => {
    const input = textInput.trim() || 'Create a balanced lineup for all quarters';
    handleGenerateLineup(input);
    setPreviousMessage(input);

    // If we were suggesting changes, clear that mode
    if (isSuggestingChanges) {
      setIsSuggestingChanges(false);
      // Clear previous results to show new ones
      setAiMessage(null);
      setSuggestedQuarters(null);
    }
  };

  const handleNewRequest = () => {
    // Clear everything for a fresh start
    setAiMessage(null);
    setSuggestedQuarters(null);
    setTextInput('');
    setPreviousMessage(null);
    setIsSuggestingChanges(false);
  };

  const handleSuggestChanges = () => {
    // Store current AI message as previous context
    if (aiMessage) {
      setPreviousMessage(aiMessage);
    }

    // Enter suggest changes mode - show text input
    setIsSuggestingChanges(true);
    setTextInput('');
  };

  const handleCancelSuggestChanges = () => {
    // Cancel suggesting changes and go back to results view
    setIsSuggestingChanges(false);
    setTextInput('');
  };

  const handleAccept = async () => {
    if (!suggestedQuarters) return;

    setIsAccepting(true);

    // Pass lineup to parent component to apply changes
    onAcceptLineup(suggestedQuarters);

    // Close modal after a brief delay
    setTimeout(() => {
      setIsAccepting(false);
      onClose();
    }, 500);
  };

  const handleClose = () => {
    setTextInput('');
    setAiMessage(null);
    setSuggestedQuarters(null);
    setPreviousMessage(null);
    setIsSuggestingChanges(false);
    onClose();
  };

  if (!isOpen) return null;

  const isLoading = fetcher.state !== 'idle' || isAccepting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-surface shadow-overlay">
        <div className="p-5 sm:p-6">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Sparkle size={22} weight="fill" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight">AI assistant coach</h2>
                <p className="text-sm text-muted">Describe the lineup you want, or hold to record.</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="-mt-1 -mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
              aria-label="Close"
            >
              <X size={20} weight="bold" />
            </button>
          </div>

          {/* Error Message */}
          {fetcher.data?.error && !isLoading && (
            <Alert tone="danger" className="mb-6">
              <h3 className="mb-1 font-semibold">The lineup didn't pass validation</h3>
              <p className="whitespace-pre-line font-normal">{fetcher.data.error}</p>
            </Alert>
          )}

          {/* AI Response Message */}
          {aiMessage && (
            <Alert tone="primary" className="mb-6">
              <h3 className="mb-1 flex items-center gap-1.5 font-semibold">
                <Sparkle size={14} weight="fill" />
                Suggestion
              </h3>
              <p className="font-normal">{aiMessage}</p>
            </Alert>
          )}

          {/* Quarter Preview */}
          {suggestedQuarters && (
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-ink">Proposed changes</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {suggestedQuarters.map((quarter) => {
                  const changesOnly = quarter.changes?.filter(c => c.isChange) || [];
                  const noChanges = quarter.changes?.filter(c => !c.isChange) || [];

                  return (
                    <div
                      key={quarter.number}
                      className={cx(
                        'rounded-xl p-4',
                        quarter.completed ? 'bg-surface-2 text-muted' : 'bg-surface-2/60 ring-1 ring-inset ring-line'
                      )}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                          Quarter {quarter.number}
                          {quarter.completed && (
                            <Badge>
                              <Lock size={12} weight="bold" />
                              Locked
                            </Badge>
                          )}
                        </div>
                        {changesOnly.length > 0 && (
                          <Badge tone="primary" className="tabular">
                            {changesOnly.length} change{changesOnly.length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>

                      {/* Show only changes, or a message if no changes */}
                      {changesOnly.length > 0 ? (
                        <div className="mb-3 divide-y divide-line overflow-hidden rounded-lg bg-surface ring-1 ring-line/70">
                          {changesOnly.map((change) => (
                            <div
                              key={change.positionNumber}
                              className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs"
                            >
                              <span className="font-semibold text-primary-ink">
                                {change.positionName}
                              </span>
                              <span className="truncate text-ink">
                                {change.playerName}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mb-3 text-xs text-muted">
                          No changes from current lineup
                        </div>
                      )}

                      {/* Show substitutes (players sitting out) */}
                      {quarter.substitutes && quarter.substitutes.length > 0 && (
                        <div className="border-t border-line pt-2">
                          <div className="mb-1.5 text-xs font-medium text-muted">Sitting out</div>
                          <div className="flex flex-wrap gap-1">
                            {quarter.substitutes.map((sub) => (
                              <Badge key={sub.playerId} tone="warning">
                                {sub.playerName}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="mb-6 flex items-center justify-center py-8">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-soft border-t-primary"></div>
                <p className="text-sm text-muted">
                  {isAccepting ? 'Applying changes...' : 'Thinking...'}
                </p>
              </div>
            </div>
          )}

          {/* Recording Error */}
          {recordingError && (
            <Alert tone="danger" className="mb-6">
              {recordingError}
            </Alert>
          )}

          {/* Input Area - Show when no results OR when suggesting changes */}
          {!isLoading && (!suggestedQuarters || isSuggestingChanges) && (
            <>
              <div className="mb-4">
                <label className={labelClass}>
                  {isSuggestingChanges ? 'What should change?' : 'What do you need?'}
                </label>

                {/* Suggestion Pills - only show for initial request */}
                {!isSuggestingChanges && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => setTextInput('Create a balanced lineup')}
                      className="h-9 rounded-full bg-primary-soft px-3.5 text-sm font-medium text-primary-ink transition hover:brightness-95"
                    >
                      Create a balanced lineup
                    </button>
                    <button
                      onClick={() => setTextInput('Rotate players fairly')}
                      className="h-9 rounded-full bg-primary-soft px-3.5 text-sm font-medium text-primary-ink transition hover:brightness-95"
                    >
                      Rotate players fairly
                    </button>
                    <button
                      onClick={() => setTextInput('Maximize playing time for everyone')}
                      className="h-9 rounded-full bg-primary-soft px-3.5 text-sm font-medium text-primary-ink transition hover:brightness-95"
                    >
                      Maximize playing time
                    </button>
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={isSuggestingChanges ? "E.g., 'Move Adam to defense' or 'Swap Charlie and Brody'..." : "Or type your own request..."}
                  className={cx(inputClass, 'resize-none')}
                  rows={3}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Text Submit Button */}
                  <Button onClick={handleTextSubmit}>
                    <Sparkle size={18} weight="fill" />
                    Submit
                  </Button>

                  {/* Voice Recording Button */}
                  <Button
                    variant={isRecording ? 'danger' : 'secondary'}
                    onMouseDown={handleRecordButtonDown}
                    onMouseUp={handleRecordButtonUp}
                    onMouseLeave={handleRecordButtonUp}
                    onTouchStart={handleRecordButtonDown}
                    onTouchEnd={handleRecordButtonUp}
                    className={cx('select-none', isRecording && 'animate-pulse')}
                  >
                    <Microphone size={18} weight={isRecording ? 'fill' : 'regular'} />
                    {isRecording ? 'Recording...' : 'Hold to record'}
                  </Button>
                </div>

                {/* Cancel button when suggesting changes */}
                {isSuggestingChanges && (
                  <Button variant="ghost" onClick={handleCancelSuggestChanges}>
                    Cancel
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Action Buttons - Show when results are available and not suggesting changes */}
          {!isLoading && suggestedQuarters && !isSuggestingChanges && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* New Request Button */}
              <Button variant="ghost" onClick={handleNewRequest}>
                <ArrowCounterClockwise size={18} />
                New request
              </Button>

              <div className="flex items-center gap-2">
                {/* Suggest Changes Button */}
                <Button variant="secondary" onClick={handleSuggestChanges}>
                  <PencilSimple size={18} />
                  Suggest changes
                </Button>

                {/* Accept Button */}
                <Button onClick={handleAccept}>
                  <Check size={18} weight="bold" />
                  Accept
                </Button>
              </div>
            </div>
          )}

          {/* Help Text */}
          <div className="mt-6 flex gap-2.5 rounded-xl bg-surface-2 p-3 text-xs text-muted">
            <Lightbulb size={16} className="mt-px shrink-0 text-subtle" />
            <p>
              The AI considers AYSO fair play rules, player strengths, and past lineups when it suggests rotations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
