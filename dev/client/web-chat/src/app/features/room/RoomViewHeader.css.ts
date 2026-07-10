import { style } from '@vanilla-extract/css';
import { config } from 'folds';

export const HeaderTopic = style({
  ':hover': {
    cursor: 'pointer',
    opacity: config.opacity.P500,
    textDecoration: 'underline',
  },
});

export const HeaderTitle = style({
  fontSize: 'calc(1em - 0.125rem)',
});
