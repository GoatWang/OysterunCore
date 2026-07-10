import React, { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Header, Menu, Scroll, config } from 'folds';

import * as css from './AutocompleteMenu.css';
import { preventScrollWithArrowKey } from '../../../utils/keyboard';

type AutocompleteMenuProps = {
  requestClose: () => void;
  headerContent: ReactNode;
  children: ReactNode;
};
export function AutocompleteMenu({ headerContent, requestClose, children }: AutocompleteMenuProps) {
  const handleMenuKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === 'Escape') {
      evt.stopPropagation();
      requestClose();
    }
  };

  const keepComposerFocus = (evt: MouseEvent) => {
    evt.preventDefault();
  };

  return (
    <div className={css.AutocompleteMenuBase}>
      <div className={css.AutocompleteMenuContainer}>
        <Menu
          className={css.AutocompleteMenu}
          data-oysterun-routec-autocomplete-focus-owner="editor"
          data-oysterun-routec-autocomplete-focus-trap="disabled"
          onKeyDown={handleMenuKeyDown}
          onMouseDown={keepComposerFocus}
        >
          <Header className={css.AutocompleteMenuHeader} size="400">
            {headerContent}
          </Header>
          <Scroll style={{ flexGrow: 1 }} onKeyDown={preventScrollWithArrowKey}>
            <div style={{ padding: config.space.S200 }}>{children}</div>
          </Scroll>
        </Menu>
      </div>
    </div>
  );
}
