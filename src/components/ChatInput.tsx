import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Smile, Paperclip, Mic, X, Image as ImageIcon, FileIcon, Square, Loader2, Sparkles, Wand2, History } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { cn } from '../lib/utils';
import { geminiService } from '../services/geminiService';

interface ChatInputProps {
  chatId: string;
  onSendMessage: (text: string) => Promise<void>;
  onSendMedia: (file: File | Blob, audioDuration?: number) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  replyingTo?: { text: string; senderName: string } | null;
  onCancelReply?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ 
  chatId, 
  onSendMessage, 
  onSendMedia, 
  onTyping,
  replyingTo,
  onCancelReply
}) => {
  const [text, setText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [showSmartTools, setShowSmartTools] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);

  // Load draft
  useEffect(() => {
    const draft = localStorage.getItem(`draft_${chatId}`);
    if (draft) setText(draft);
  }, [chatId]);

  // Save draft
  useEffect(() => {
    if (text) {
      localStorage.setItem(`draft_${chatId}`, text);
    } else {
      localStorage.removeItem(`draft_${chatId}`);
    }
  }, [text, chatId]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onTyping(e.target.value.length > 0);
    
    // Auto resize
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    if (!text.trim() || isSending) return;
    setIsSending(true);
    setActionError(null);
    try {
      await onSendMessage(text);
      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (error) {
      console.error('Failed to send the message.', error);
      setActionError(error instanceof Error ? error.message : 'The message could not be sent.');
    } finally {
      setIsSending(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        try {
          if (!discardRecordingRef.current && recordingTime > 1) {
            await onSendMedia(audioBlob, recordingTime);
          }
        } catch (error) {
          console.error('Failed to send the voice message.', error);
          setActionError(error instanceof Error ? error.message : 'The voice message could not be sent.');
        } finally {
          discardRecordingRef.current = false;
          stream.getTracks().forEach(track => track.stop());
        }
      };

      discardRecordingRef.current = false;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Recording error:", err);
      setActionError('Could not access the microphone. Check your browser permission and try again.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const cancelRecording = () => {
    discardRecordingRef.current = true;
    stopRecording();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const onDrop = useCallback((acceptedFiles: File[], fileRejections: FileRejection[]) => {
    const rejectionMessage = fileRejections.slice(0, 2)
      .map(({ file, errors }) => `${file.name}: ${errors.map(({ message }) => message).join(', ')}`)
      .join('; ');
    setActionError(rejectionMessage || null);
    void Promise.all(acceptedFiles.map(file => onSendMedia(file))).catch((error: unknown) => {
      console.error('Failed to send a dropped attachment.', error);
      setActionError(error instanceof Error ? error.message : 'The attachment could not be sent.');
    });
  }, [onSendMedia]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    accept: {
      'image/*': [],
      'video/*': [],
      'application/pdf': [],
      'application/msword': [],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': []
    },
    maxSize: 50 * 1024 * 1024,
    maxFiles: 5,
  });

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          void onSendMedia(file).catch((error: unknown) => {
            console.error('Failed to send the pasted image.', error);
            setActionError(error instanceof Error ? error.message : 'The image could not be sent.');
          });
        }
      }
    }
  };

  const improveWithAI = async (tone: 'professional' | 'friendly' | 'concise' | 'humorous') => {
    if (!text.trim()) return;
    setIsImproving(true);
    setActionError(null);
    try {
      const improved = await geminiService.improveWriting(text, tone);
      setText(improved);
    } catch (error) {
      console.error('The AI writing request failed.', error);
      setActionError(error instanceof Error ? error.message : 'The writing suggestion could not be generated.');
    } finally {
      setIsImproving(false);
    }
  };

  return (
    <div className="relative border-t border-[#f0f2f5] bg-white/60 backdrop-blur-3xl px-8 py-5" {...getRootProps()} onPaste={handlePaste}>
      <input {...getInputProps()} />

      {actionError && (
        <div className="mx-auto mb-3 flex max-w-5xl items-center justify-between rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="ml-4 font-semibold">Dismiss</button>
        </div>
      )}
      
      {isDragActive && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-emerald-500/10 backdrop-blur-xl border-2 border-dashed border-emerald-500/30 rounded-t-[40px] animate-pulse">
          <div className="flex flex-col items-center text-emerald-600">
            <Paperclip className="h-10 w-10 mb-4" />
            <span className="font-black uppercase tracking-[0.2em] text-[10px]">Deployment Mode: Drop to Securely Send</span>
          </div>
        </div>
      )}

      {/* Reply Preview */}
      <AnimatePresence>
        {replyingTo && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="mb-4 mx-2 p-4 bg-gray-50/80 backdrop-blur-sm rounded-[24px] border border-gray-100 flex items-center justify-between shadow-sm group"
          >
            <div className="flex items-center space-x-4 overflow-hidden">
               <div className="h-10 w-1 bg-emerald-500 rounded-full" />
               <div className="overflow-hidden">
                 <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Uplink Response to {replyingTo.senderName}</p>
                 <p className="text-sm text-gray-500 truncate italic">"{replyingTo.text}"</p>
               </div>
            </div>
            <button onClick={onCancelReply} className="p-2 hover:bg-gray-200/50 rounded-xl transition-colors">
              <X className="h-5 w-5 text-gray-400" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end space-x-4 relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center space-x-2 mb-1">
          <button 
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className={cn(
              "p-3 rounded-2xl transition-all active:scale-90", 
              showEmojiPicker ? "text-emerald-500 bg-emerald-50 shadow-inner" : "text-gray-400 hover:bg-[#f0f2f5]/80"
            )}
          >
            <Smile className="h-6 w-6" />
          </button>
          
          <div className="relative group">
            <button className="p-3 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50/50 rounded-2xl transition-all active:scale-95">
              <Paperclip className="h-6 w-6" />
            </button>
            <div className="absolute bottom-full left-0 mb-4 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100 origin-bottom-left z-[100]">
              <div className="bg-white/90 backdrop-blur-2xl rounded-[28px] shadow-2xl border border-[#f0f2f5] p-3 flex flex-col space-y-1 min-w-[200px]">
                <button type="button" onClick={open} className="px-5 py-4 hover:bg-emerald-50 rounded-2xl text-emerald-600 flex items-center space-x-4 transition-all group/item">
                  <ImageIcon className="h-5 w-5 group-hover/item:scale-110 transition-transform" />
                  <span className="text-xs font-black uppercase tracking-wider">Visual Asset</span>
                </button>
                <button type="button" onClick={open} className="px-5 py-4 hover:bg-blue-50 rounded-2xl text-blue-600 flex items-center space-x-4 transition-all group/item">
                  <FileIcon className="h-5 w-5 group-hover/item:scale-110 transition-transform" />
                  <span className="text-xs font-black uppercase tracking-wider">Data Payload</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 relative group/input">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? "Neural Uplink Active..." : "Transmit message..."}
            disabled={isRecording}
            className={cn(
              "w-full bg-[#f0f2f5]/50 rounded-[28px] px-6 py-4 pr-16 outline-none resize-none text-[15px] font-medium max-h-[200px] transition-all",
              "focus:bg-white focus:ring-[6px] focus:ring-emerald-500/5 focus:shadow-[0_8px_30px_rgb(0,0,0,0.04)] placeholder:text-[#667781]/50 placeholder:font-bold placeholder:uppercase placeholder:tracking-widest placeholder:text-[10px]"
            )}
          />
          
          <AnimatePresence>
            {text.length > 0 && !isRecording && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: 10 }}
                type="button"
                aria-label="Send message"
                disabled={isSending}
                className="absolute right-3 bottom-3 p-2 bg-emerald-500 text-white rounded-2xl shadow-xl shadow-emerald-500/20 cursor-pointer active:scale-95 transition-all hover:bg-emerald-600 disabled:cursor-wait"
                onClick={() => void handleSend()}
              >
                {isSending ? <Loader2 className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6" />}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center space-x-2 mb-1">
          <button 
            onClick={() => setShowSmartTools(!showSmartTools)}
            className={cn(
              "p-3 rounded-2xl transition-all active:scale-90", 
              showSmartTools ? "text-purple-500 bg-purple-50 shadow-inner" : "text-gray-400 hover:text-purple-500 hover:bg-purple-50/50"
            )}
          >
            <Sparkles className="h-6 w-6" />
          </button>

          {!text.length && (
            <button 
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={stopRecording}
              className={cn(
                "p-3.5 rounded-2.5xl transition-all relative overflow-hidden group shadow-xl active:scale-95",
                isRecording ? "bg-rose-500 text-white rotate-6 scale-110 shadow-rose-500/20" : "bg-emerald-500 text-white shadow-emerald-500/20"
              )}
            >
              <div className="relative z-10 transition-transform group-hover:scale-110">
                {isRecording ? <Square className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </div>
              {isRecording && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.2, 0.5, 0.2] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="absolute inset-0 bg-white"
                />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Recording Display */}
      <AnimatePresence>
        {isRecording && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute inset-x-0 bottom-0 top-0 z-20 bg-white flex items-center px-6 space-x-6"
          >
             <div className="flex items-center space-x-4 flex-1">
                <div className="flex items-center space-x-1">
                   {[1,2,3,4,5,6,7,8].map(i => (
                     <motion.div 
                       key={i}
                       animate={{ height: [4, 12, 4] }}
                       transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
                       className="w-1 bg-rose-500 rounded-full"
                     />
                   ))}
                </div>
                <span className="text-sm font-bold text-rose-500">{formatTime(recordingTime)}</span>
                <span className="text-xs font-medium text-gray-400 animate-pulse">Recording voice... Release to send</span>
             </div>
             <button type="button" onClick={cancelRecording} aria-label="Cancel voice recording" className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all">
               <X className="h-6 w-6" />
             </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Emoji Picker Overlay */}
      <AnimatePresence>
        {showEmojiPicker && (
          <motion.div 
            initial={{ opacity: 0, bottom: '80%' }}
            animate={{ opacity: 1, bottom: '100%' }}
            exit={{ opacity: 0, bottom: '80%' }}
            className="absolute left-4 mb-4 z-50"
          >
            <div className="bg-white rounded-3xl shadow-2xl border border-black/5 overflow-hidden">
               <EmojiPicker 
                 theme={Theme.LIGHT} 
                 onEmojiClick={(data) => {
                   setText(prev => prev + data.emoji);
                   setShowEmojiPicker(false);
                 }} 
               />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Smart Tools Overlay */}
      <AnimatePresence>
        {showSmartTools && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-4 right-4 mb-4 z-50 p-6 bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl border border-black/5"
          >
            <div className="flex items-center justify-between mb-4">
               <div>
                  <h3 className="text-sm font-bold flex items-center">
                    <Sparkles className="h-4 w-4 mr-2 text-purple-500" />
                    AI Writing Assistant
                  </h3>
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mt-1">Refine your message with Gemini-3</p>
               </div>
               <button onClick={() => setShowSmartTools(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                 <X className="h-4 w-4 text-gray-400" />
               </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
               {[
                 { id: 'friendly', name: 'Friendly', icon: Smile, color: 'text-amber-500 bg-amber-50' },
                 { id: 'professional', name: 'Professional', icon: Wand2, color: 'text-blue-500 bg-blue-50' },
                 { id: 'concise', name: 'Concise', icon: History, color: 'text-emerald-500 bg-emerald-50' },
                 { id: 'humorous', name: 'Witty', icon: Sparkles, color: 'text-purple-500 bg-purple-50' }
               ].map(tool => (
                 <button 
                  key={tool.id}
                  onClick={() => void improveWithAI(tool.id as 'friendly' | 'professional' | 'concise' | 'humorous')}
                  disabled={isImproving || !text.trim()}
                  className={cn(
                    "p-4 rounded-2xl flex flex-col items-center justify-center space-y-2 transition-all active:scale-95",
                    tool.color,
                    (isImproving || !text.trim()) && "opacity-50 grayscale"
                  )}
                 >
                   <tool.icon className="h-6 w-6" />
                   <span className="text-[10px] font-bold uppercase tracking-widest">{tool.name}</span>
                 </button>
               ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
