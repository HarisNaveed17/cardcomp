// The loading banner: a progress bar, a factual line ("HBL Gold CreditCard: 48 of 167")
// and a rotating light-hearted phrase, so the polite request gap feels shorter.

import { $, h } from './dom.js';

const PHRASES = [
  'Waiting for banks to respond…',
  'Doing some hisab kitab…',
  'Asking the waiter which card has the best discount…',
  'Reading the fine print so you don’t have to…',
  'Checking if it’s valid on Tuesdays…',
  'Counting the chhutta…',
  'Bas do minute…',
  'Finding out what “up to” really means…',
  'Turning “T&Cs apply” into rupees…',
  'Waiting for our token number to be called…',
  'Bargaining with the bank manager…',
  'Brewing chai while the server thinks…',
  'Checking the caps, not the chai…',
  'Asking the guard uncle for directions…',
  'Adding up the discounts, carrying the 1…',
];
const PHRASE_MS = 2600;

let timer = null;
let order = [];

function nextPhrase() {
  if (!order.length) order = [...PHRASES].sort(() => Math.random() - 0.5);
  return order.pop();
}

function el() {
  let box = $('#progress');
  if (!box.firstChild) {
    box.append(
      h('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span')),
      h('div', { class: 'progress-text' }, h('span', { class: 'progress-phrase' }), h('span', { class: 'progress-detail muted small' })));
  }
  return box;
}

/** Show or update the banner. fraction: 0..1, or null for an indeterminate bar. */
export function showProgress(detail, fraction = null) {
  const box = el();
  box.hidden = false;
  const bar = box.querySelector('.progress-bar');
  bar.classList.toggle('indeterminate', fraction == null);
  bar.firstChild.style.width = fraction == null ? '' : `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  if (fraction == null) bar.removeAttribute('aria-valuenow');
  else bar.setAttribute('aria-valuenow', Math.round(fraction * 100));
  box.querySelector('.progress-detail').textContent = detail || '';
  if (!timer) {
    const phrase = box.querySelector('.progress-phrase');
    phrase.textContent = nextPhrase();
    timer = setInterval(() => (phrase.textContent = nextPhrase()), PHRASE_MS);
  }
}

export function hideProgress() {
  clearInterval(timer);
  timer = null;
  const box = $('#progress');
  if (box) box.hidden = true;
}
