import React from 'react';
import { VoiceState } from '../../services/voice/voiceTypes';
import { RestaurantOSAssistant, AssistantState } from './RestaurantOSAssistant';

export interface RestaurantOsAssistantCharacterProps {
  state?: VoiceState | AssistantState;
  isWaving?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  className?: string;
  onClick?: () => void;
  showBadge?: boolean;
}

export const RestaurantOsAssistantCharacter: React.FC<RestaurantOsAssistantCharacterProps> = ({
  state = 'IDLE',
  isWaving = false,
  size = 'md',
  className = '',
  onClick,
  showBadge = true
}) => {
  return (
    <RestaurantOSAssistant
      state={state}
      isWaving={isWaving}
      size={size}
      className={className}
      onClick={onClick}
      showBadge={showBadge}
      id="restaurantos-assistant-character-root"
    />
  );
};

export { RestaurantOSAssistant };

