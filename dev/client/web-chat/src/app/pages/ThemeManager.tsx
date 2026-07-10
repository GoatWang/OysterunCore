import React, { ReactNode, useEffect } from 'react';
import { configClass, varsClass } from 'folds';
import {
  DarkTheme,
  LightTheme,
  OysterunTheme,
  ThemeContextProvider,
  ThemeKind,
  useActiveTheme,
  useSystemThemeKind,
} from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { useSetting } from '../state/hooks/settings';
import type { ChatTheme } from '../state/settings';
import { settingsAtom } from '../state/settings';
import { hasOysterunHostSessionRoute } from '../../oysterun/OysterunHostClient';

function getOysterunRouteCTheme(activeTheme: Theme, chatTheme: ChatTheme): Theme {
  // Route C owns its default theme and does not inherit browser/system light mode.
  if (!hasOysterunHostSessionRoute()) return activeTheme;
  if (chatTheme === 'dark') return DarkTheme;
  if (chatTheme === 'light') return LightTheme;
  return OysterunTheme;
}

export function UnAuthRouteThemeManager() {
  const systemThemeKind = useSystemThemeKind();

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);
    if (systemThemeKind === ThemeKind.Dark) {
      document.body.classList.add(...DarkTheme.classNames);
    }
    if (systemThemeKind === ThemeKind.Light) {
      document.body.classList.add(...LightTheme.classNames);
    }
  }, [systemThemeKind]);

  return null;
}

export function AuthRouteThemeManager({ children }: { children: ReactNode }) {
  const activeTheme = useActiveTheme();
  const [chatTheme] = useSetting(settingsAtom, 'chat_theme');
  const routeScopedTheme = getOysterunRouteCTheme(activeTheme, chatTheme);
  const [monochromeMode] = useSetting(settingsAtom, 'monochromeMode');

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);

    document.body.classList.add(...routeScopedTheme.classNames);

    if (monochromeMode) {
      document.body.style.filter = 'grayscale(1)';
    } else {
      document.body.style.filter = '';
    }
  }, [routeScopedTheme, monochromeMode]);

  return <ThemeContextProvider value={routeScopedTheme}>{children}</ThemeContextProvider>;
}
