import { keyframes, style } from '@vanilla-extract/css';

export const SplashScreen = style({
  minHeight: '100%',
  backgroundColor: '#9b968d',
  color: '#2b241f',
  letterSpacing: 0,
});

export const OriginalTransitionViewport = style({
  boxSizing: 'border-box',
  minHeight: '100dvh',
  width: '100%',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 'clamp(104px, 24vh, 240px) 18px 32px',
  background: '#9b968d',
  '@media': {
    '(max-width: 640px)': {
      paddingTop: 'clamp(76px, 22vh, 150px)',
    },
  },
});

export const OriginalTransitionCard = style({
  boxSizing: 'border-box',
  width: 'min(520px, 100%)',
  minHeight: '274px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '14px',
  padding: '38px 34px',
  border: '1px solid rgba(255, 255, 255, 0.68)',
  borderRadius: '30px',
  background: '#fffaf5',
  boxShadow: '0 24px 70px rgba(64, 48, 36, 0.22)',
  textAlign: 'center',
  '@media': {
    '(max-width: 640px)': {
      minHeight: '252px',
      padding: '32px 24px',
    },
  },
});

const originalTransitionSpin = keyframes({
  to: {
    transform: 'rotate(360deg)',
  },
});

export const OriginalTransitionSpinner = style({
  width: '38px',
  height: '38px',
  border: '3px solid rgba(185, 116, 74, 0.2)',
  borderTopColor: '#b8744a',
  borderRadius: '999px',
  animation: `${originalTransitionSpin} 900ms linear infinite`,
});

export const OriginalTransitionPill = style({
  marginTop: '4px',
  padding: '6px 12px',
  borderRadius: '999px',
  background: '#f5d2bd',
  color: '#8d5638',
  fontSize: '11px',
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
});

export const OriginalTransitionTitle = style({
  margin: '4px 0 0',
  color: '#2b241f',
  fontSize: '28px',
  fontWeight: 650,
  lineHeight: 1.18,
  letterSpacing: 0,
});

export const OriginalTransitionCopy = style({
  maxWidth: '30rem',
  margin: 0,
  color: '#6d635b',
  fontSize: '15px',
  lineHeight: 1.5,
});
