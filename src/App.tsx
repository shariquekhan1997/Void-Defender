/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Rocket, Shield, Play, RotateCcw, Trophy, Target, Volume2, VolumeX, Pause, Square } from 'lucide-react';

// --- Audio Engine ---
class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgOsc: OscillatorNode | null = null;
  private bgGain: GainNode | null = null;
  private isMuted: boolean = false;

  constructor() {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.error('AudioContext not supported');
    }
  }

  setMute(mute: boolean) {
    this.isMuted = mute;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 1, this.ctx!.currentTime, 0.1);
    }
  }

  playLaser() {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playExplosion() {
    if (!this.ctx || this.isMuted) return;
    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.2);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    
    noise.start();
    noise.stop(this.ctx.currentTime + 0.2);
  }

  startMusic() {
    if (!this.ctx || this.bgOsc) return;
    
    this.bgOsc = this.ctx.createOscillator();
    this.bgGain = this.ctx.createGain();
    
    this.bgOsc.type = 'triangle';
    this.bgOsc.frequency.setValueAtTime(55, this.ctx.currentTime); // A1
    
    this.bgGain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    
    this.bgOsc.connect(this.bgGain);
    this.bgGain.connect(this.masterGain!);
    
    this.bgOsc.start();
    
    // Simple drone modulation
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.5;
    lfoGain.gain.value = 2;
    lfo.connect(lfoGain);
    lfoGain.connect(this.bgOsc.frequency);
    lfo.start();
  }

  stopMusic() {
    if (this.bgOsc) {
      this.bgOsc.stop();
      this.bgOsc = null;
    }
  }

  resume() {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }
}

// --- Constants ---
const SHIP_SIZE = 40;
const BULLET_SIZE = 4;
const BULLET_SPEED = 7;
const INITIAL_SPEED = 0.8;
const SPEED_INCREMENT = 0.15;
const SPAWN_RATE = 1500; // ms

type EnemyType = 'meteor' | 'comet' | 'alien';

interface Enemy {
  id: number;
  x: number;
  y: number;
  type: EnemyType;
  health: number;
  maxHealth: number;
  speed: number;
}

interface Bullet {
  id: number;
  x: number;
  y: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>('start');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('void-defender-highscore');
    return saved ? parseInt(saved) : 0;
  });

  const soundManager = useMemo(() => new SoundManager(), []);

  // Game Refs for performance
  const shipPos = useRef({ x: 0, y: 0 });
  const enemies = useRef<Enemy[]>([]);
  const bullets = useRef<Bullet[]>([]);
  const lastSpawn = useRef(0);
  const lastFire = useRef(0);
  const requestRef = useRef<number>(0);
  const keys = useRef<Record<string, boolean>>({});

  // Level Thresholds: Level L needs L * 100 points to pass
  const getLevelThreshold = useCallback((l: number) => {
    // Threshold for level L is (L * (L + 1) / 2) * 100
    // L=1: 100, L=2: 300, L=3: 600, L=4: 1000, L=5: 1500
    return (l * (l + 1) / 2) * 100;
  }, []);

  const initGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    soundManager.resume();
    soundManager.startMusic();
    shipPos.current = { x: canvas.width / 2, y: canvas.height - 60 };
    enemies.current = [];
    bullets.current = [];
    lastFire.current = 0;
    setScore(0);
    setLevel(1);
    setGameState('playing');
  }, [soundManager]);

  const spawnEnemy = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (time - lastSpawn.current > SPAWN_RATE / (1 + (level - 1) * 0.2)) {
      const types: EnemyType[] = ['meteor', 'comet', 'alien'];
      const type = types[Math.floor(Math.random() * types.length)];
      
      let health = 10; // Meteor and Comet are 1 hit
      if (type === 'alien') health = 30; // Alien is 3 hits

      const newEnemy: Enemy = {
        id: Date.now() + Math.random(),
        x: Math.random() * (canvas.width - 40) + 20,
        y: -50,
        type,
        health,
        maxHealth: health,
        speed: INITIAL_SPEED + (level - 1) * SPEED_INCREMENT + Math.random() * 0.5,
      };

      enemies.current.push(newEnemy);
      lastSpawn.current = time;
    }
  }, [level]);

  const update = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas || isPaused) {
      if (isPaused) draw(); // Keep drawing while paused to show the state
      requestRef.current = requestAnimationFrame(update);
      return;
    }

    // Move Ship
    const speed = 5;
    if (keys.current['ArrowLeft'] || keys.current['a']) shipPos.current.x -= speed;
    if (keys.current['ArrowRight'] || keys.current['d']) shipPos.current.x += speed;
    
    // Clamp ship
    shipPos.current.x = Math.max(SHIP_SIZE / 2, Math.min(canvas.width - SHIP_SIZE / 2, shipPos.current.x));

    // Auto-fire
    const fireRate = 300; // ms between shots
    if (time - lastFire.current > fireRate) {
      soundManager.playLaser();
      bullets.current.push({
        id: Date.now() + Math.random(),
        x: shipPos.current.x,
        y: shipPos.current.y - 20
      });
      lastFire.current = time;
    }

    // Update Bullets
    bullets.current = bullets.current.filter(b => b.y > -10);
    bullets.current.forEach(b => b.y -= BULLET_SPEED);

    // Update Enemies
    enemies.current.forEach(e => {
      e.y += e.speed;
      if (e.y > canvas.height) {
        setGameState('gameover');
        soundManager.stopMusic();
      }
    });

    // Collision Detection
    bullets.current.forEach((b, bi) => {
      enemies.current.forEach((e, ei) => {
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 25) {
          e.health -= 10;
          bullets.current.splice(bi, 1);
          if (e.health <= 0) {
            setScore(prev => prev + 10);
            soundManager.playExplosion();
            enemies.current.splice(ei, 1);
          }
        }
      });
    });

    spawnEnemy(time);
    draw();
    requestRef.current = requestAnimationFrame(update);
  }, [level, spawnEnemy, soundManager, isPaused]);

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Ship
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    const { x, y } = shipPos.current;
    
    ctx.beginPath();
    // Body
    ctx.moveTo(x, y - 25);
    ctx.lineTo(x - 10, y - 5);
    ctx.lineTo(x - 10, y + 15);
    ctx.lineTo(x + 10, y + 15);
    ctx.lineTo(x + 10, y - 5);
    ctx.closePath();
    ctx.stroke();

    // Wings
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 5);
    ctx.lineTo(x - 25, y + 15);
    ctx.lineTo(x - 10, y + 15);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 10, y + 5);
    ctx.lineTo(x + 25, y + 15);
    ctx.lineTo(x + 10, y + 15);
    ctx.stroke();

    // Cockpit
    ctx.beginPath();
    ctx.arc(x, y - 5, 5, 0, Math.PI * 2);
    ctx.stroke();

    // Draw Bullets
    ctx.fillStyle = '#FFFFFF';
    bullets.current.forEach(b => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_SIZE, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Enemies
    enemies.current.forEach(e => {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      
      if (e.type === 'meteor') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 15, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === 'comet') {
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - 15);
        ctx.lineTo(e.x - 10, e.y + 15);
        ctx.lineTo(e.x + 10, e.y + 15);
        ctx.closePath();
        ctx.stroke();
      } else {
        // Alien
        ctx.strokeRect(e.x - 15, e.y - 10, 30, 20);
        ctx.beginPath();
        ctx.moveTo(e.x - 10, e.y - 10);
        ctx.lineTo(e.x - 15, e.y - 20);
        ctx.moveTo(e.x + 10, e.y - 10);
        ctx.lineTo(e.x + 15, e.y - 20);
        ctx.stroke();
      }

      // Health Bar
      const healthWidth = 30 * (e.health / e.maxHealth);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(e.x - 15, e.y + 20, healthWidth, 3);
    });
  };

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    const handleKeyDown = (e: KeyboardEvent) => {
      keys.current[e.key] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.current[e.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState, soundManager]);

  useEffect(() => {
    // Derive level from score
    // Level 1: 0-99
    // Level 2: 100-299
    // Level 3: 300-599
    // Level 4: 600-999
    // Level 5: 1000-1499
    // Level 6: 1500+
    let calculatedLevel = 1;
    while (score >= getLevelThreshold(calculatedLevel)) {
      calculatedLevel++;
    }
    
    if (calculatedLevel !== level) {
      setLevel(calculatedLevel);
    }
  }, [score, level, getLevelThreshold]);

  useEffect(() => {
    if (level > 1) {
      setShowLevelUp(true);
      const timer = setTimeout(() => setShowLevelUp(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [level]);

  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(update);
    } else {
      cancelAnimationFrame(requestRef.current);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [gameState, update]);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('void-defender-highscore', score.toString());
    }
  }, [score, highScore]);

  const toggleMute = () => {
    const newMute = !isMuted;
    setIsMuted(newMute);
    soundManager.setMute(newMute);
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
    if (!isPaused) {
      soundManager.stopMusic();
    } else {
      soundManager.startMusic();
    }
  };

  const stopGame = () => {
    setGameState('start');
    setIsPaused(false);
    soundManager.stopMusic();
  };

  // Touch Controls
  const handleTouch = (e: React.TouchEvent) => {
    if (gameState !== 'playing') return;
    const touch = e.touches[0];
    shipPos.current.x = touch.clientX;
  };

  return (
    <div className="fixed inset-0 bg-black text-white font-mono overflow-hidden select-none touch-none">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        onTouchMove={handleTouch}
        onTouchStart={handleTouch}
      />

      {/* HUD */}
      <div className="absolute top-6 left-6 flex flex-col gap-1">
        <div className="text-2xl font-bold tracking-tighter">SCORE: {score}</div>
        <div className="text-sm opacity-50">LEVEL: {level}</div>
        <div className="text-xs opacity-30">BEST: {highScore}</div>
      </div>

      {/* Controls HUD */}
      <div className="absolute top-6 right-6 flex items-center gap-2">
        {gameState === 'playing' && (
          <>
            <button
              onClick={togglePause}
              className="p-2 border border-white/20 hover:bg-white/10 transition-colors"
              title={isPaused ? "Resume" : "Pause"}
            >
              {isPaused ? <Play className="w-6 h-6 fill-current" /> : <Pause className="w-6 h-6" />}
            </button>
            <button
              onClick={stopGame}
              className="p-2 border border-white/20 hover:bg-white/10 transition-colors"
              title="Stop"
            >
              <Square className="w-6 h-6 fill-current" />
            </button>
          </>
        )}
        <button
          onClick={toggleMute}
          className="p-2 border border-white/20 hover:bg-white/10 transition-colors"
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
        </button>
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {gameState === 'start' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-50"
          >
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className="text-center p-8 border-2 border-white max-w-sm"
            >
              <Rocket className="w-16 h-16 mx-auto mb-6" />
              <h1 className="text-4xl font-black mb-2 tracking-tighter">VOID DEFENDER</h1>
              <p className="text-sm mb-8 opacity-60 leading-relaxed">
                DEFEND THE PLANET SURFACE.<br />
                MOVE WITH ARROWS OR TOUCH.
              </p>
              <button
                onClick={initGame}
                className="w-full py-4 bg-white text-black font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors"
              >
                <Play className="w-5 h-5 fill-current" />
                INITIATE DEFENSE
              </button>
            </motion.div>
          </motion.div>
        )}

        {gameState === 'gameover' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-50"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="text-center p-8 border-2 border-white"
            >
              <Shield className="w-16 h-16 mx-auto mb-6 opacity-50" />
              <h2 className="text-4xl font-black mb-2 tracking-tighter">PLANET FALLEN</h2>
              <div className="flex justify-center gap-8 mb-8">
                <div>
                  <div className="text-xs opacity-50">SCORE</div>
                  <div className="text-2xl font-bold">{score}</div>
                </div>
                <div>
                  <div className="text-xs opacity-50">LEVEL</div>
                  <div className="text-2xl font-bold">{level}</div>
                </div>
              </div>
              <button
                onClick={initGame}
                className="w-full py-4 bg-white text-black font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors"
              >
                <RotateCcw className="w-5 h-5" />
                RETRY MISSION
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Level Up Notification */}
      <AnimatePresence>
        {showLevelUp && (
          <motion.div
            key={level}
            initial={{ opacity: 0, scale: 0.5, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.5 }}
            className="absolute top-1/4 left-1/2 -translate-x-1/2 pointer-events-none"
          >
            <div className="px-6 py-2 border-2 border-white bg-black text-2xl font-black italic">
              LEVEL {level}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
