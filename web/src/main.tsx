// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { getIdToken, handleCallback, isFramed, onSignInElsewhere, signedInUser, signIn, signInPopup } from './auth';
import './styles.css';

/**
 * Sign-in comes before the first render (auth.ts): back from managed login with `?code=&state=`,
 * finish it (in a sign-in popup, hand it to the frame that opened it); with nobody signed in, go
 * there, or, inside a frame, offer a button that signs in through a popup; otherwise render the app.
 */
async function start() {
  const root = document.getElementById('root')!;
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('code') && params.has('state') && (await handleCallback()) === 'popup') return;
    if ((await getIdToken()) === null) {
      if (isFramed()) {
        framedSignIn(root);
        return;
      }
      await signIn();
      return;
    }
    const user = await signedInUser();
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App user={user} />
      </React.StrictMode>,
    );
  } catch (e: any) {
    root.textContent = `The app could not start: ${e.message}. Reload the page to try again.`;
  }
}

/**
 * Inside a frame: a popup needs a click, so the frame shows one button until sign-in is done, here
 * or in another frame of the same deck (onSignInElsewhere).
 */
function framedSignIn(root: HTMLElement) {
  let stopListening = onSignInElsewhere(() => start());
  root.replaceChildren();
  const card = document.createElement('div');
  card.className = 'card framed-sign-in';
  const title = document.createElement('h2');
  title.textContent = 'Multimodal AI knowledge graph';
  const text = document.createElement('p');
  text.className = 'muted';
  text.textContent = 'This demo runs inside another page. To continue, sign in through a small popup window.';
  const button = document.createElement('button');
  button.textContent = 'Sign in';
  const error = document.createElement('p');
  error.className = 'error';
  button.addEventListener('click', () => {
    button.disabled = true;
    error.textContent = '';
    stopListening();
    signInPopup()
      .then(() => start())
      .catch((e: any) => {
        button.disabled = false;
        error.textContent = `Sign-in did not finish: ${e.message}. Allow popups for this page and try again.`;
        stopListening = onSignInElsewhere(() => start());
      });
  });
  card.append(title, text, button, error);
  root.append(card);
}

start();
