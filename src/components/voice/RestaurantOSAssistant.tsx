import React from 'react';
import { VoiceState } from '../../services/voice/voiceTypes';

export type AssistantState =
  | 'idle'
  | 'entering'
  | 'smile'
  | 'wave'
  | 'listening'
  | 'thinking'
  | 'confused'
  | 'confirmation'
  | 'success'
  | 'error'
  | 'stopped'
  | VoiceState;

export interface RestaurantOSAssistantProps {
  state?: AssistantState;
  size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  isWaving?: boolean;
  interactive?: boolean;
  showBadge?: boolean;
  className?: string;
  onClick?: () => void;
  id?: string;
}

export const RestaurantOSAssistant: React.FC<RestaurantOSAssistantProps> = ({
  state = 'idle',
  size = 'md',
  isWaving = false,
  interactive = true,
  showBadge = true,
  className = '',
  onClick,
  id = 'restaurantos-assistant-character'
}) => {
  // Normalize state to internal state string
  const normalizedState = String(state).toLowerCase();

  // Map voice state aliases
  const isListening =
    normalizedState === 'listening' || normalizedState === 'hearing';
  const isThinking =
    normalizedState === 'thinking' || normalizedState === 'processing';
  const isConfused =
    normalizedState === 'confused' || normalizedState === 'needs_clarification';
  const isConfirmation = normalizedState === 'confirmation';
  const isSuccess = normalizedState === 'success';
  const isError = normalizedState === 'error';
  const isStopped =
    normalizedState === 'stopped' || normalizedState === 'off';
  const isEntering = normalizedState === 'entering';
  const isWaveState = normalizedState === 'wave' || isWaving;
  const isSmileState = normalizedState === 'smile';

  // Dimension scaling logic
  const getDimensions = () => {
    if (typeof size === 'number') {
      return { width: size, height: Math.round(size * 1.25) };
    }
    switch (size) {
      case 'sm':
        return { width: 68, height: 85 };
      case 'lg':
        return { width: 120, height: 150 };
      case 'xl':
        return { width: 160, height: 200 };
      case 'md':
      default:
        return { width: 92, height: 115 };
    }
  };

  const { width, height } = getDimensions();

  return (
    <div
      id={id}
      onClick={onClick}
      className={`relative inline-flex flex-col items-center justify-center select-none ${
        onClick && interactive
          ? 'cursor-pointer hover:scale-105 active:scale-95 transition-transform'
          : 'pointer-events-none'
      } ${className}`}
      aria-label={`RestaurantOS Voice Assistant: ${state}`}
      role={onClick && interactive ? 'button' : 'img'}
      tabIndex={onClick && interactive ? 0 : undefined}
    >
      {/* CSS Keyframe Animations */}
      <style>{`
        @keyframes rosBreathing {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-3px) scale(1.015); }
        }
        @keyframes rosWavingArm {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(24deg); }
          75% { transform: rotate(-18deg); }
        }
        @keyframes rosListeningPulse {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.15); opacity: 0.35; }
        }
        @keyframes rosThinkingDots {
          0%, 100% { transform: translateY(0px); opacity: 0.3; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes rosCelebrateHop {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-7px) scale(1.04); }
        }
        @keyframes rosWalkLegLeft {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(25deg); }
        }
        @keyframes rosWalkLegRight {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(-25deg); }
        }

        .ros-breathe-anim { animation: rosBreathing 3.2s ease-in-out infinite; }
        .ros-wave-arm-anim { animation: rosWavingArm 0.9s ease-in-out infinite; transform-origin: 22px 62px; }
        .ros-pulse-halo { animation: rosListeningPulse 1.4s ease-in-out infinite; }
        .ros-celebrate-anim { animation: rosCelebrateHop 0.55s ease-in-out infinite; }
        .ros-think-dot-1 { animation: rosThinkingDots 1.2s ease-in-out infinite 0s; }
        .ros-think-dot-2 { animation: rosThinkingDots 1.2s ease-in-out infinite 0.2s; }
        .ros-think-dot-3 { animation: rosThinkingDots 1.2s ease-in-out infinite 0.4s; }
        .ros-walk-left { animation: rosWalkLegLeft 0.5s ease-in-out infinite; transform-origin: 41px 92px; }
        .ros-walk-right { animation: rosWalkLegRight 0.5s ease-in-out infinite; transform-origin: 59px 92px; }

        @media (prefers-reduced-motion: reduce) {
          .ros-breathe-anim,
          .ros-wave-arm-anim,
          .ros-pulse-halo,
          .ros-celebrate-anim,
          .ros-think-dot-1,
          .ros-think-dot-2,
          .ros-think-dot-3,
          .ros-walk-left,
          .ros-walk-right {
            animation: none !important;
          }
        }
      `}</style>

      {/* State Glow Halos */}
      {isListening && (
        <div className="absolute inset-0 rounded-full bg-rose-400/25 ros-pulse-halo blur-md pointer-events-none" />
      )}
      {isThinking && (
        <div className="absolute inset-0 rounded-full bg-indigo-400/25 ros-pulse-halo blur-md pointer-events-none" />
      )}
      {isSuccess && (
        <div className="absolute inset-0 rounded-full bg-emerald-400/30 ros-pulse-halo blur-md pointer-events-none" />
      )}

      {/* Official Canonical RestaurantOS Chef Character Vector Graphic */}
      <svg
        width={width}
        height={height}
        viewBox="0 0 100 125"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`w-auto h-auto transition-all duration-300 ${
          isSuccess ? 'ros-celebrate-anim' : 'ros-breathe-anim'
        }`}
      >
        <defs>
          {/* Chef Hat White Soft Gradient */}
          <linearGradient id="chefHatWhite" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="70%" stopColor="#FAFAFC" />
            <stop offset="100%" stopColor="#E2E8F0" />
          </linearGradient>

          {/* Hair Dark Brown Gradient */}
          <linearGradient id="hairBrown" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4A2810" />
            <stop offset="50%" stopColor="#361B09" />
            <stop offset="100%" stopColor="#241004" />
          </linearGradient>

          {/* Skin Warm Tone Gradient */}
          <linearGradient id="skinTone" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFE0CC" />
            <stop offset="100%" stopColor="#F7C8AC" />
          </linearGradient>

          {/* Black Apron Charcoal Gradient */}
          <linearGradient id="blackApron" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#27272A" />
            <stop offset="100%" stopColor="#18181B" />
          </linearGradient>

          {/* Navy Blue Pants Gradient */}
          <linearGradient id="navyPants" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>

          {/* Shadow Filter */}
          <filter id="softDropShadow" x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" floodOpacity="0.18" floodColor="#0F172A" />
          </filter>
        </defs>

        {/* 1. Ground Contact Shadow */}
        <ellipse cx="50" cy="119" rx="26" ry="4.5" fill="#0F172A" fillOpacity="0.15" />

        {/* 2. Legs & Shoes */}
        {/* Left Leg */}
        <g className={isEntering ? 'ros-walk-left' : ''}>
          <rect x="37" y="91" width="9.5" height="18" rx="4.5" fill="url(#navyPants)" />
          {/* Black Sneaker with White Sole & Laces */}
          <path d="M 32 107 C 32 104 36 103 41 103 L 46 103 C 48 103 49 105 49 107 L 49 112 C 49 114 47 115 45 115 L 34 115 C 32.5 115 32 113.5 32 112 Z" fill="#18181B" />
          {/* White Rubber Sole */}
          <rect x="32" y="112.5" width="17" height="3" rx="1" fill="#FFFFFF" />
          {/* White Laces */}
          <line x1="39" y1="106" x2="44" y2="106" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="39" y1="108.5" x2="44" y2="108.5" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
        </g>

        {/* Right Leg */}
        <g className={isEntering ? 'ros-walk-right' : ''}>
          <rect x="53.5" y="91" width="9.5" height="18" rx="4.5" fill="url(#navyPants)" />
          {/* Black Sneaker with White Sole & Laces */}
          <path d="M 51 107 C 51 104 55 103 60 103 L 65 103 C 67 103 68 105 68 107 L 68 112 C 68 114 66 115 64 115 L 53 115 C 51.5 115 51 113.5 51 112 Z" fill="#18181B" />
          {/* White Rubber Sole */}
          <rect x="51" y="112.5" width="17" height="3" rx="1" fill="#FFFFFF" />
          {/* White Laces */}
          <line x1="58" y1="106" x2="63" y2="106" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="58" y1="108.5" x2="63" y2="108.5" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
        </g>

        {/* 3. Left Arm & Hand */}
        <g className={isWaveState || isEntering || isSuccess ? 'ros-wave-arm-anim' : ''}>
          {/* Arm stroke */}
          <path
            d={
              isWaveState || isSuccess || isEntering
                ? 'M 25 61 C 15 48 14 34 20 25'
                : isConfirmation
                ? 'M 26 62 C 16 66 12 56 18 48'
                : isError
                ? 'M 26 62 C 16 68 14 78 20 83'
                : 'M 26 61 C 18 69 16 78 21 82'
            }
            stroke="url(#skinTone)"
            strokeWidth="7.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* Hand */}
          <circle
            cx={isWaveState || isSuccess || isEntering ? 20 : isConfirmation ? 18 : 21}
            cy={isWaveState || isSuccess || isEntering ? 23 : isConfirmation ? 48 : 82}
            r="4.8"
            fill="url(#skinTone)"
          />
        </g>

        {/* 4. Right Arm & Hand */}
        <g>
          <path
            d={
              isSuccess
                ? 'M 75 61 C 85 48 86 34 80 25'
                : isThinking
                ? 'M 74 62 C 78 52 68 45 60 46'
                : isConfirmation
                ? 'M 74 62 C 84 66 88 56 82 48'
                : 'M 74 61 C 82 69 84 78 79 82'
            }
            stroke="url(#skinTone)"
            strokeWidth="7.5"
            strokeLinecap="round"
            fill="none"
          />
          <circle
            cx={isSuccess ? 80 : isThinking ? 58 : isConfirmation ? 82 : 79}
            cy={isSuccess ? 23 : isThinking ? 46 : isConfirmation ? 48 : 82}
            r="4.8"
            fill="url(#skinTone)"
          />
        </g>

        {/* 5. Torso & White Shirt */}
        <path d="M 31 58 L 69 58 L 67 92 L 33 92 Z" fill="#FFFFFF" />
        {/* Short Sleeves */}
        <path d="M 27 58 L 35 58 L 33 66 L 25 64 Z" fill="#FFFFFF" />
        <path d="M 65 58 L 73 58 L 75 64 L 67 66 Z" fill="#FFFFFF" />

        {/* Red Bow Tie */}
        <g filter="url(#softDropShadow)">
          <path d="M 44 56 L 50 58 L 44 60 Z" fill="#EF4444" />
          <path d="M 56 56 L 50 58 L 56 60 Z" fill="#EF4444" />
          <circle cx="50" cy="58" r="2" fill="#DC2626" />
        </g>

        {/* 6. Black Apron */}
        <path
          d="M 35 56 C 35 56 42 54.5 50 54.5 C 58 54.5 65 56 65 56 L 67 94 C 67 96.5 65 98.5 62.5 98.5 L 37.5 98.5 C 35 98.5 33 96.5 33 94 Z"
          fill="url(#blackApron)"
          filter="url(#softDropShadow)"
        />

        {/* Apron Straps & Buttons */}
        <path d="M 37 54.5 L 43 43" stroke="#27272A" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M 63 54.5 L 57 43" stroke="#27272A" strokeWidth="2.8" strokeLinecap="round" />
        <circle cx="38" cy="57" r="1.5" fill="#E4E4E7" />
        <circle cx="62" cy="57" r="1.5" fill="#E4E4E7" />

        {/* Front Apron Pocket */}
        <path d="M 41 77 L 59 77 L 57.5 93 L 42.5 93 Z" fill="#18181B" stroke="#3F3F46" strokeWidth="0.8" />

        {/* RestaurantOS Apron Logo (Yellow Chef Hat + RestaurantOS Text) */}
        <g transform="translate(42, 60)">
          {/* Chef Hat Icon Outline */}
          <path
            d="M 5 1.5 C 4 0.2 6.5 -0.5 8 0.5 C 9.5 -0.5 12 0.2 11 1.5 C 12.5 2 12.5 4 11 4.5 L 5 4.5 C 3.5 4 3.5 2 5 1.5 Z"
            fill="none"
            stroke="#F59E0B"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <rect x="5.5" y="4.5" width="5" height="1" fill="#F59E0B" />
          {/* Text "RestaurantOS" */}
          <text x="8" y="9.5" fill="#FFFFFF" fontSize="3.8" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">
            Restaurant<tspan fill="#38BDF8">OS</tspan>
          </text>
        </g>

        {/* 7. Head & Facial Features */}
        <ellipse cx="50" cy="38" rx="22" ry="19.5" fill="url(#skinTone)" filter="url(#softDropShadow)" />

        {/* Ears */}
        <circle cx="28" cy="38" r="4.2" fill="url(#skinTone)" />
        <circle cx="72" cy="38" r="4.2" fill="url(#skinTone)" />

        {/* Dark Wavy Hair */}
        <path
          d="M 28 35 C 26 22 34 16 48 18 C 62 16 73 22 72 35 C 68 28 62 26 50 27 C 38 26 32 28 28 35 Z"
          fill="url(#hairBrown)"
        />
        {/* Hair Swoop Bangs */}
        <path
          d="M 32 26 C 38 20 52 21 58 26 C 50 23 40 23 32 26 Z"
          fill="#5C3317"
        />

        {/* 8. Official Chef Hat (Toque Blanche) */}
        <g filter="url(#softDropShadow)">
          {/* Puffy Top Folds */}
          <path
            d="M 30 22 C 26 12 34 2 43 4 C 47 -1 55 -1 60 4 C 68 2 75 12 70 22 Z"
            fill="url(#chefHatWhite)"
          />
          {/* Black Hat Band */}
          <rect x="31" y="19" width="38" height="5" rx="2" fill="#18181B" />

          {/* RestaurantOS Hat Logo */}
          <g transform="translate(36, 19.5)">
            <path
              d="M 3 1 C 2.5 0.2 4 -0.3 5 0.3 C 6 -0.3 7.5 0.2 7 1 C 8 1.4 8 2.6 7 3 L 3 3 C 2 2.6 2 1.4 3 1 Z"
              fill="none"
              stroke="#F59E0B"
              strokeWidth="0.8"
            />
            <text x="9" y="3" fill="#FFFFFF" fontSize="3.2" fontWeight="bold" fontFamily="sans-serif">
              Restaurant<tspan fill="#38BDF8">OS</tspan>
            </text>
          </g>
        </g>

        {/* 9. Eyes & Expressions */}
        {isStopped ? (
          /* Closed Sleeping Eyes (- -) */
          <g stroke="#3F3F46" strokeWidth="2.2" strokeLinecap="round">
            <path d="M 40 37 Q 44 40 46 37" fill="none" />
            <path d="M 54 37 Q 56 40 60 37" fill="none" />
          </g>
        ) : isSuccess || isSmileState ? (
          /* Happy Crescent Eyes (^ ^) */
          <g stroke="#241004" strokeWidth="2.5" strokeLinecap="round">
            <path d="M 39 38 Q 43 32 47 38" fill="none" />
            <path d="M 53 38 Q 57 32 61 38" fill="none" />
          </g>
        ) : isThinking ? (
          /* Looking Upward Thinking Eyes */
          <g>
            <circle cx="43" cy="34.5" r="3.6" fill="#241004" />
            <circle cx="57" cy="34.5" r="3.6" fill="#241004" />
            <circle cx="44.2" cy="33.2" r="1.3" fill="#FFFFFF" />
            <circle cx="58.2" cy="33.2" r="1.3" fill="#FFFFFF" />
            {/* Thinking Animated Dots */}
            <g>
              <circle cx="46" cy="11" r="2.2" fill="#6366F1" className="ros-think-dot-1" />
              <circle cx="53" cy="8" r="2" fill="#818CF8" className="ros-think-dot-2" />
              <circle cx="60" cy="10" r="1.8" fill="#A5B4FC" className="ros-think-dot-3" />
            </g>
          </g>
        ) : isConfused ? (
          /* Curious Eyebrows & Eyes */
          <g>
            <circle cx="43" cy="36" r="3.5" fill="#241004" />
            <circle cx="57" cy="35" r="4.2" fill="#241004" />
            <circle cx="44" cy="35" r="1.2" fill="#FFFFFF" />
            <circle cx="58" cy="34" r="1.4" fill="#FFFFFF" />
            {/* Eyebrow raised */}
            <path d="M 52 28 Q 57 23 63 27" stroke="#241004" strokeWidth="2" strokeLinecap="round" fill="none" />
            {/* Floating '?' mark */}
            <text x="66" y="22" fill="#0284C7" fontSize="11" fontWeight="bold" fontFamily="sans-serif">
              ?
            </text>
          </g>
        ) : isError ? (
          /* Apologetic Gentle Eyes */
          <g>
            <circle cx="43" cy="36.5" r="3.5" fill="#241004" />
            <circle cx="57" cy="36.5" r="3.5" fill="#241004" />
            <path d="M 39 31 L 46 33" stroke="#4B5563" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 61 31 L 54 33" stroke="#4B5563" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        ) : (
          /* Default Warm Large Brown Eyes */
          <g>
            {/* Eyebrows */}
            <path d="M 39 30 Q 43 28 47 30" stroke="#241004" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            <path d="M 53 30 Q 57 28 61 30" stroke="#241004" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            {/* Eyeballs */}
            <circle cx="43" cy="36" r="3.8" fill="#241004" />
            <circle cx="57" cy="36" r="3.8" fill="#241004" />
            {/* Specular Gloss Reflections */}
            <circle cx="44.5" cy="34.5" r="1.4" fill="#FFFFFF" />
            <circle cx="58.5" cy="34.5" r="1.4" fill="#FFFFFF" />
          </g>
        )}

        {/* Rosy Blush Cheeks */}
        <circle cx="35" cy="40.5" r="3.8" fill="#F43F5E" fillOpacity="0.32" />
        <circle cx="65" cy="40.5" r="3.8" fill="#F43F5E" fillOpacity="0.32" />

        {/* 10. Mouth Expressions */}
        {isStopped ? (
          <path d="M 46 44.5 Q 50 46.5 54 44.5" stroke="#4B5563" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        ) : isSuccess || isSmileState ? (
          /* Wide Happy Smile */
          <path d="M 42 42 C 42 51 58 51 58 42 Z" fill="#E11D48" stroke="#BE123C" strokeWidth="1.2" />
        ) : isListening ? (
          /* Speaking/Listening open mouth */
          <ellipse cx="50" cy="44.5" rx="4" ry="3.2" fill="#BE123C" />
        ) : isConfused ? (
          /* Small O mouth */
          <circle cx="50" cy="44.5" r="2.8" fill="#BE123C" />
        ) : isError ? (
          <path d="M 45 46 Q 50 43 55 46" stroke="#374151" strokeWidth="2" strokeLinecap="round" fill="none" />
        ) : (
          /* Default Warm Smile */
          <path d="M 43 43.5 Q 50 49.5 57 43.5" stroke="#BE123C" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        )}
      </svg>

      {/* State Status Badge Overlay */}
      {showBadge && (
        <div className="absolute -bottom-1 transform translate-y-1/2 z-10">
          {isListening && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white shadow-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              Listening
            </span>
          )}
          {isThinking && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white shadow-xs">
              Processing...
            </span>
          )}
          {isSuccess && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shadow-xs">
              Done! ✨
            </span>
          )}
          {isStopped && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-700 shadow-2xs">
              Muted
            </span>
          )}
        </div>
      )}
    </div>
  );
};
