import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, Target as TargetIcon, Volume2, VolumeX, Upload, Music } from 'lucide-react';
import { sounds } from './utils/sounds';
import { cn } from './utils/cn';

// Constants
const SPAWN_INTERVAL_BASE = 400; 
const MIN_SPAWN_INTERVAL = 200;  
const FALL_DURATION_BASE = 2200; 
const MIN_FALL_DURATION = 1400;
const ACCURACY_THRESHOLD = 75;
const GRACE_PERIOD_MS = 5000;

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME';
const DIFFICULTY_WINDOWS: Record<Difficulty, number> = {
  EASY: 400,
  MEDIUM: 250,
  HARD: 125,
  EXTREME: 75
};

interface Square {
  id: number;
  targetX: number; // percentage 0-100
  targetY: number; // percentage 0-100
  startTime: number;
  duration: number;
  size: number;
  isHit: boolean;
}

const DEFAULT_SONGS = [
  { id: '1', name: 'Midnight City', url: 'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3', artist: 'Synth' },
  { id: '2', name: 'Ethereal Dream', url: 'https://cdn.pixabay.com/audio/2021/11/25/audio_91b32e02f9.mp3', artist: 'Ambient' },
];

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'MENU' | 'PLAYING' | 'GAMEOVER'>('MENU');
  const [score, setScore] = useState(0);
  const [squares, setSquares] = useState<Square[]>([]);
  const [accuracy, setAccuracy] = useState(100);
  const [stats, setStats] = useState({ hit: 0, missed: 0, combo: 0, maxCombo: 0 });
  const [failReason, setFailReason] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isMuted, setIsMuted] = useState(false);
  const [selectedSong, setSelectedSong] = useState(DEFAULT_SONGS[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [customMusicUrl, setCustomMusicUrl] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ x: number, y: number } | null>(null);
  const gameLoopRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastSpawnRef = useRef<number>(0);

  const startGame = () => {
    setGameState('PLAYING');
    setScore(0);
    setSquares([]);
    setAccuracy(100);
    setStats({ hit: 0, missed: 0, combo: 0, maxCombo: 0 });
    setFailReason('');
    startTimeRef.current = Date.now();
    lastSpawnRef.current = 0;
    sounds.startMusic(customMusicUrl || selectedSong.url);
  };

  const endGame = (reason: string) => {
    setGameState('GAMEOVER');
    setSquares([]); // Clear squares immediately on fail
    setFailReason(reason);
    if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    sounds.stopMusic();
    sounds.playFail();
  };

  const spawnSquare = useCallback((now: number) => {
    const elapsed = now - startTimeRef.current;
    const difficultyScale = Math.min(elapsed / 60000, 1);
    
    const newSquare: Square = {
      id: now + Math.random(),
      targetX: -30 + Math.random() * 160, // Maximum spread
      targetY: -30 + Math.random() * 160, 
      startTime: now,
      duration: FALL_DURATION_BASE - (FALL_DURATION_BASE - MIN_FALL_DURATION) * difficultyScale,
      size: 55 + Math.random() * 35,
      isHit: false
    };

    setSquares(prev => [...prev, newSquare]);
  }, []);

  // Main Game Loop
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    const tick = () => {
      const now = Date.now();
      setCurrentTime(now); // Sync all components to this frame
      const elapsed = now - startTimeRef.current;

      // 1. Spawning
      const difficultyScale = Math.min(elapsed / 60000, 1);
      const interval = SPAWN_INTERVAL_BASE - (SPAWN_INTERVAL_BASE - MIN_SPAWN_INTERVAL) * difficultyScale;
      if (now - lastSpawnRef.current > interval) {
        spawnSquare(now);
        lastSpawnRef.current = now;
      }

      // 2. Lifecycle & Collision
      setSquares(prev => {
        let missedOne = false;
        let anyHit = false;
        
        const next = prev.filter(s => {
          const sElapsed = now - s.startTime;
          const progress = sElapsed / s.duration;

          // Start of interaction window (30% of duration)
          const interactionStart = s.duration * 0.30;
          const interactionEnd = interactionStart + DIFFICULTY_WINDOWS[difficulty];

          // If the square has passed the interaction window and wasn't hit
          if (sElapsed > interactionEnd && !s.isHit) {
            missedOne = true;
            return false;
          }

          // Check Collision
          const isCollectible = sElapsed > interactionStart && sElapsed <= interactionEnd;

          if (!s.isHit && isCollectible && pointerRef.current && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const currentX = 50 + (s.targetX - 50) * progress;
            const currentY = 50 + (s.targetY - 50) * progress;
            
            const pixelX = (currentX / 100) * rect.width;
            const pixelY = (currentY / 100) * rect.height;
            
            const dx = pointerRef.current.x - pixelX;
            const dy = pointerRef.current.y - pixelY;
            const dist = Math.sqrt(dx*dx + dy*dy);

            // Generous hitbox (radius based on square size + 20px padding)
            if (dist < (s.size * 0.5 * progress * 3) + 30) {
              s.isHit = true;
              anyHit = true;
              return false;
            }
          }

          return true;
        });

        if (anyHit) {
          sounds.playHit();
          setScore(v => v + 100);
          setStats(st => {
            const newCombo = st.combo + 1;
            return {
              ...st,
              hit: st.hit + 1,
              combo: newCombo,
              maxCombo: Math.max(st.maxCombo, newCombo)
            };
          });
        }

        if (missedOne) {
          setStats(st => ({ ...st, missed: st.missed + 1, combo: 0 }));
          endGame('SQUARE MISSED (PERFECT MODE)');
        }

        return next;
      });

      gameLoopRef.current = requestAnimationFrame(tick);
    };

    gameLoopRef.current = requestAnimationFrame(tick);
    return () => {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, [gameState, spawnSquare]);

  // Accuracy Failure Logic
  useEffect(() => {
    const total = stats.hit + stats.missed;
    if (total > 0) {
      const acc = Math.round((stats.hit / total) * 100);
      setAccuracy(acc);

      const elapsed = Date.now() - startTimeRef.current;
      if (gameState === 'PLAYING' && elapsed > GRACE_PERIOD_MS && total >= 5 && acc < ACCURACY_THRESHOLD) {
        endGame('ACCURACY BELOW 75%');
      }
    }
  }, [stats.hit, stats.missed, gameState]);

  const handlePointer = (e: React.PointerEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      pointerRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  };

  return (
    <div className="relative w-full h-screen bg-neutral-950 text-white overflow-hidden font-sans select-none touch-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_#171717_0%,_#000_100%)] pointer-events-none" />
      
      {/* GAME AREA */}
      <div 
        ref={containerRef}
        className="relative w-full h-full"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
      >
        {/* Render Squares - Only show if playing or in menu */}
        {gameState !== 'GAMEOVER' && squares.map(s => (
          <SquareComponent key={s.id} square={s} currentTime={currentTime} windowSize={DIFFICULTY_WINDOWS[difficulty]} />
        ))}

        {/* HUD */}
        {gameState === 'PLAYING' && (
          <>
              <div className="absolute top-6 left-0 w-full flex flex-col items-center pointer-events-none z-10">
                <div className="text-xs font-bold text-white tracking-[0.3em] uppercase mb-1">
                  {customMusicUrl ? 'Custom Track' : selectedSong.name}
                </div>
                <div className="text-sm font-mono text-neutral-400">0:{Math.floor((Date.now() - startTimeRef.current)/1000).toString().padStart(2, '0')} / 1:23</div>
              <div className="w-48 h-[2px] bg-neutral-800 mt-4 relative overflow-hidden">
                <motion.div 
                  className="absolute inset-0 bg-white shadow-[0_0_10px_white]"
                  animate={{ x: `${Math.min((stats.hit / 50) * 100, 100) - 100}%` }}
                />
              </div>
            </div>

            <button 
              onClick={() => {
                const newMuted = !isMuted;
                setIsMuted(newMuted);
                sounds.setMuted(newMuted);
              }}
              className="absolute top-6 right-6 z-20 p-2 text-white/40 hover:text-white transition-colors"
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>

            <div className="absolute left-6 bottom-12 flex flex-col pointer-events-none">
               <div className="border-l-2 border-orange-500 pl-4">
                  <div className="text-[10px] text-neutral-500 font-black tracking-[0.2em] uppercase leading-none mb-1">Accuracy</div>
                  <div className="text-3xl font-black italic text-white leading-none">{accuracy}%</div>
               </div>
            </div>

            <div className="absolute right-6 bottom-12 flex flex-col items-end pointer-events-none">
               <div className="border-r-2 border-orange-500 pr-4 text-right">
                  <div className="text-[10px] text-neutral-500 font-black tracking-[0.2em] uppercase leading-none mb-1">Combo</div>
                  <motion.div key={stats.combo} animate={{ scale: [1.3, 1] }} transition={{ duration: 0.1 }} className="text-5xl font-black italic text-orange-500 leading-none">{stats.combo}x</motion.div>
               </div>
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none opacity-40">
                <div className="text-[8px] text-white font-bold tracking-[0.5em] uppercase italic">Perfect Mode Active</div>
                <div className="w-24 h-[1px] bg-gradient-to-r from-transparent via-white to-transparent" />
            </div>
          </>
        )}

        {/* OVERLAYS */}
        <AnimatePresence>
          {gameState === 'MENU' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md z-30 p-6 text-center">
                <div className="w-20 h-20 border-4 border-white mb-8 rotate-45 flex items-center justify-center">
                  <TargetIcon size={40} className="-rotate-45" />
                </div>
                <h1 className="text-6xl font-black mb-4 italic tracking-tighter">SQUARE RUSH</h1>
                <p className="text-neutral-400 mb-12 max-w-xs text-sm">Drag your finger across the squares as they fly towards you. One miss means failure.</p>
                <button 
                  onClick={() => {
                    sounds.playHit();
                    startGame();
                  }} 
                  className="px-12 py-4 bg-white text-black font-black text-xl italic hover:scale-105 transition-transform rounded-sm mb-6 w-full"
                >
                  INITIALIZE SEQUENCE
                </button>

                <div className="flex flex-col items-center gap-4 w-full">
                  <div className="w-full">
                    <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mb-2 text-left">Difficulty</div>
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      {(['EASY', 'MEDIUM', 'HARD', 'EXTREME'] as Difficulty[]).map(d => (
                        <button
                          key={d}
                          onClick={() => {
                            setDifficulty(d);
                            sounds.playHit();
                          }}
                          className={cn(
                            "py-2 rounded text-[10px] font-bold transition-all border",
                            difficulty === d 
                              ? "bg-orange-600 text-white border-orange-600 shadow-[0_0_15px_rgba(234,88,12,0.4)]"
                              : "bg-transparent text-white border-white/10 hover:bg-white/5"
                          )}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    
                    <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mb-2 text-left">Select Track</div>
                    <div className="flex flex-col gap-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                      {DEFAULT_SONGS.map(song => (
                        <button
                          key={song.id}
                          onClick={() => {
                            setSelectedSong(song);
                            setCustomMusicUrl(null);
                            sounds.playHit();
                          }}
                          className={cn(
                            "flex justify-between items-center px-4 py-2 rounded text-xs transition-all border",
                            selectedSong.id === song.id && !customMusicUrl
                              ? "bg-white text-black border-white font-black"
                              : "bg-transparent text-white border-white/10 hover:bg-white/5"
                          )}
                        >
                          <span>{song.name}</span>
                          <span className="opacity-40 italic">{song.artist}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 px-4 py-2 border border-white/20 rounded hover:bg-white/5 cursor-pointer transition-colors w-full justify-center">
                    <Upload size={16} />
                    <span className="text-xs font-bold tracking-widest uppercase">
                      {customMusicUrl ? 'Change Custom Audio' : 'Upload Custom Audio'}
                    </span>
                    <input 
                      type="file" 
                      accept="audio/*" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = URL.createObjectURL(file);
                          setCustomMusicUrl(url);
                          sounds.playHit();
                        }
                      }}
                    />
                  </label>
                  {customMusicUrl && (
                    <div className="flex items-center gap-2 text-[10px] text-orange-500 font-bold uppercase tracking-widest animate-pulse">
                      <Music size={10} /> Custom Track Active
                    </div>
                  )}
                </div>
            </motion.div>
          )}

          {gameState === 'GAMEOVER' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-2xl z-30 p-6 text-center">
                <h2 className="text-7xl font-black mb-2 text-red-600 italic tracking-tighter">FAILED</h2>
                <div className="text-red-500 font-bold uppercase tracking-widest mb-8 text-xs opacity-80">{failReason}</div>
                
                <div className="grid grid-cols-2 gap-4 mb-12 w-full max-w-sm">
                  <div className="bg-neutral-900/50 p-4 border border-neutral-800 rounded-xl">
                    <div className="text-[10px] text-neutral-500 uppercase font-bold mb-1">Score</div>
                    <div className="text-3xl font-black italic">{score.toLocaleString()}</div>
                  </div>
                  <div className="bg-neutral-900/50 p-4 border border-neutral-800 rounded-xl">
                    <div className="text-[10px] text-neutral-500 uppercase font-bold mb-1">Max Combo</div>
                    <div className="text-3xl font-black italic">{stats.maxCombo}</div>
                  </div>
                </div>

                <div className="flex flex-col gap-4 w-full max-w-sm">
                  <button 
                    onClick={() => {
                      sounds.playHit();
                      startGame();
                    }} 
                    className="w-full py-5 bg-white text-black font-black text-xl italic flex items-center justify-center gap-3 rounded-xl"
                  >
                    <RotateCcw size={24} /> RETRY SEQUENCE
                  </button>
                  <button 
                    onClick={() => {
                      sounds.playHit();
                      setGameState('MENU');
                    }} 
                    className="w-full py-4 border border-white/20 text-white font-bold opacity-60 hover:opacity-100 transition-opacity"
                  >
                    BACK TO HUB
                  </button>
                </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const SquareComponent: React.FC<{ square: Square, currentTime: number, windowSize: number }> = ({ square, currentTime, windowSize }) => {
  const sElapsed = currentTime - square.startTime;
  const progress = Math.min(sElapsed / square.duration, 1);
  
  const interactionStart = square.duration * 0.30;
  const interactionEnd = interactionStart + windowSize;
  
  const isCollectible = sElapsed > interactionStart && sElapsed <= interactionEnd;
  
  // Visual glow starts fading in at 10% and is full by 30%
  const glowStart = square.duration * 0.10;
  const glowIntensity = sElapsed < glowStart 
    ? 0 
    : Math.min(1, (sElapsed - glowStart) / (interactionStart - glowStart));
    
  const isPostCollect = sElapsed > interactionEnd;

  const currentX = 50 + (square.targetX - 50) * progress;
  const currentY = 50 + (square.targetY - 50) * progress;
  const scale = 0.1 + (progress * 3.5);
  
  // Smoothly fade in/out overall opacity
  let opacity = 1;
  if (progress < 0.1) opacity = progress / 0.1;
  else if (progress > 0.9) opacity = Math.max(0, 1 - (progress - 0.9) / 0.1);

  return (
    <div 
      className="absolute pointer-events-none"
      style={{
        left: `${currentX}%`,
        top: `${currentY}%`,
        width: square.size,
        height: square.size,
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity: opacity,
        zIndex: 100 + Math.floor(progress * 1000)
      }}
    >
      <div 
        className="w-full h-full border-[4px] rounded-2xl transition-all duration-75"
        style={{
          borderColor: `rgba(255, 255, 255, ${0.2 + (glowIntensity * 0.8)})`,
          backgroundColor: `rgba(255, 255, 255, ${0.05 + (glowIntensity * 0.45)})`,
          boxShadow: glowIntensity > 0 ? `0 0 ${glowIntensity * 50}px white` : 'none',
          transform: isCollectible ? 'scale(1.1)' : 'scale(1)',
          filter: isPostCollect ? 'grayscale(0.5) opacity(0.5)' : 'none'
        }}
      />
    </div>
  );
};

export default App;
