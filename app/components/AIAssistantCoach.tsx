import { useState, useEffect, useRef, useCallback } from 'react';
import { useFetcher } from 'react-router';
import { useAudioRecorder } from '~/hooks/useAudioRecorder';

interface AIAssistantCoachProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: number;
  teamId: number;
  onAcceptLineup: (quarters: QuarterLineup[]) => void;
}

interface QuarterLineup {
  number: number;
  completed: boolean;
  players: Record<number, number>; // positionNumber -> playerId
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

  // Define handleGenerateLineup before useEffects that use it
  const handleGenerateLineup = useCallback((input: string) => {
    const formData = new FormData();
    formData.append('_action', 'generate');
    formData.append('gameId', gameId.toString());
    formData.append('teamId', teamId.toString());
    formData.append('userInput', input);
    if (previousMessage) {
      formData.append('previousMessage', previousMessage);
    }

    // Clear current suggestions while loading
    setAiMessage(null);
    setSuggestedQuarters(null);

    fetcher.submit(formData, {
      method: 'post',
      action: '/api/ai-lineup',
    });
  }, [gameId, teamId, previousMessage, fetcher]);

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
  };

  const handleSuggestChanges = () => {
    // Store current AI message as previous context
    if (aiMessage) {
      setPreviousMessage(aiMessage);
    }

    // Clear current state
    setAiMessage(null);
    setSuggestedQuarters(null);
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
    onClose();
  };

  if (!isOpen) return null;

  const isLoading = fetcher.state !== 'idle' || isAccepting;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <span>🤖</span>
              <span>AI Assistant Coach</span>
            </h2>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-full transition"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Error Message */}
          {fetcher.data?.error && !isLoading && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <h3 className="text-sm font-semibold text-red-800 mb-2">⚠️ Validation Error:</h3>
              <p className="text-sm text-red-700 whitespace-pre-line">{fetcher.data.error}</p>
            </div>
          )}

          {/* AI Response Message */}
          {aiMessage && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-sm font-semibold text-blue-800 mb-2">AI Suggestion:</h3>
              <p className="text-sm text-blue-700">{aiMessage}</p>
            </div>
          )}

          {/* Quarter Preview */}
          {suggestedQuarters && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Proposed Lineup Changes:</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {suggestedQuarters.map((quarter) => (
                  <div
                    key={quarter.number}
                    className={`p-3 border rounded-lg ${
                      quarter.completed
                        ? 'bg-gray-100 border-gray-300'
                        : 'bg-green-50 border-green-200'
                    }`}
                  >
                    <div className="text-xs font-semibold mb-1">
                      Quarter {quarter.number}
                      {quarter.completed && ' (Locked)'}
                    </div>
                    <div className="text-xs text-gray-600">
                      {Object.keys(quarter.players).length} players assigned
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="mb-6 flex items-center justify-center py-8">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm text-gray-600">
                  {isAccepting ? 'Applying changes...' : 'Thinking...'}
                </p>
              </div>
            </div>
          )}

          {/* Error Messages */}
          {(recordingError || (fetcher.data?.error)) && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">
                {recordingError || fetcher.data?.error}
              </p>
            </div>
          )}

          {/* Input Area */}
          {!isLoading && (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ask the AI Assistant Coach:
                </label>

                {/* Suggestion Pills */}
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    onClick={() => setTextInput('Create a balanced lineup')}
                    className="px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100 transition"
                  >
                    Create a balanced lineup
                  </button>
                  <button
                    onClick={() => setTextInput('Rotate players fairly')}
                    className="px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100 transition"
                  >
                    Rotate players fairly
                  </button>
                  <button
                    onClick={() => setTextInput('Maximize playing time for everyone')}
                    className="px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100 transition"
                  >
                    Maximize playing time
                  </button>
                </div>

                <textarea
                  ref={textareaRef}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Or type your own request..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {/* Text Submit Button */}
                  <button
                    onClick={handleTextSubmit}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition text-sm font-medium"
                  >
                    Submit
                  </button>

                  {/* Voice Recording Button */}
                  <button
                    onMouseDown={handleRecordButtonDown}
                    onMouseUp={handleRecordButtonUp}
                    onMouseLeave={handleRecordButtonUp}
                    onTouchStart={handleRecordButtonDown}
                    onTouchEnd={handleRecordButtonUp}
                    className={`px-4 py-2 rounded-lg transition text-sm font-medium flex items-center gap-2 ${
                      isRecording
                        ? 'bg-red-600 text-white animate-pulse'
                        : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                    </svg>
                    {isRecording ? 'Recording...' : 'Hold to Record'}
                  </button>
                </div>

                {/* Suggest Changes & Accept Buttons */}
                {suggestedQuarters && (
                  <div className="flex items-center gap-2">
                    {/* Suggest Changes Voice Button */}
                    <button
                      onMouseDown={() => {
                        handleSuggestChanges();
                        handleRecordButtonDown();
                      }}
                      onMouseUp={handleRecordButtonUp}
                      onMouseLeave={handleRecordButtonUp}
                      onTouchStart={() => {
                        handleSuggestChanges();
                        handleRecordButtonDown();
                      }}
                      onTouchEnd={handleRecordButtonUp}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition text-sm font-medium flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                      </svg>
                      Suggest Changes
                    </button>

                    {/* Accept Button */}
                    <button
                      onClick={handleAccept}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
                    >
                      Accept
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Help Text */}
          <div className="mt-6 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-xs text-gray-600">
              💡 <strong>Tip:</strong> The AI considers AYSO fair play rules, player strengths, and past game lineups to suggest optimal rotations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
