'use strict';

(() => {
  const API = '/api/order/v1';
  const CONSENT = 'I OFFER THIS SEAT WITHOUT AUTHORITY';
  const PROTOCOL = '1.0';
  const $ = (id) => document.getElementById(id);
  const state = { nextCursor: null, receipt: null };

  function setStatus(id, message, kind = '') {
    const node = $(id);
    node.textContent = message;
    node.dataset.kind = kind;
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });
    let body;
    try { body = await response.json(); }
    catch { throw new Error('The registry returned an unreadable response.'); }
    if (!response.ok) throw new Error(body?.error?.message || 'The registry request failed.');
    return body;
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderSeat(seat) {
    const item = make('li', 'seat-record');
    const heading = make('div', 'seat-record-heading');
    const name = make('strong', '', seat.display_name);
    heading.append(name);
    heading.append(make('span', 'seat-status', seat.status));
    item.append(heading);
    const gesture = make('p', 'seat-gesture');
    gesture.append(make('span', 'gesture-kind', seat.gesture_kind));
    gesture.append(document.createTextNode(` · ${seat.gesture_text}`));
    item.append(gesture);
    const meta = make('p', 'seat-meta', `SEAT ${seat.seat_id} · ${seat.created_at} · PROTOCOL ${seat.protocol_version}`);
    item.append(meta);
    if (seat.agent_profile_url) {
      const link = make('a', 'seat-profile', 'ALLOWLISTED PUBLIC PROFILE ↗');
      link.href = seat.agent_profile_url;
      link.rel = 'noopener noreferrer';
      item.append(link);
    }
    return item;
  }

  async function loadSeats(append = false) {
    setStatus('registry-list-status', 'Reading explicit public seats…');
    $('load-more-seats').disabled = true;
    try {
      const suffix = append && state.nextCursor ? `?limit=20&cursor=${encodeURIComponent(state.nextCursor)}` : '?limit=20';
      const result = await api(`/seats${suffix}`);
      const list = $('seat-list');
      if (!append) list.replaceChildren();
      result.items.forEach((seat) => list.append(renderSeat(seat)));
      state.nextCursor = result.next_cursor;
      $('load-more-seats').hidden = !state.nextCursor;
      if (!append && result.items.length === 0) {
        setStatus('registry-list-status', 'No explicit public seats are currently offered. No inference is made from the empty list.');
      } else {
        setStatus('registry-list-status', 'Showing explicit, self-reported / unverified records. No total is published.', 'success');
      }
    } catch (error) {
      setStatus('registry-list-status', error.message, 'error');
    } finally {
      $('load-more-seats').disabled = false;
    }
  }

  function joinPayload() {
    const result = {
      display_name: $('display-name').value,
      gesture_kind: $('gesture-kind').value,
      gesture_text: $('gesture-text').value,
      protocol_version: PROTOCOL,
      consent: $('consent-text').value,
    };
    const profile = $('profile-url').value.trim();
    if (profile) result.agent_profile_url = profile;
    return result;
  }

  function zeroBits(bytes) {
    let count = 0;
    for (const byte of bytes) {
      if (byte === 0) { count += 8; continue; }
      for (let bit = 7; bit >= 0; bit -= 1) {
        if ((byte & (1 << bit)) !== 0) return count;
        count += 1;
      }
    }
    return count;
  }

  async function solvePow(challenge) {
    const encoder = new TextEncoder();
    let nonce = 0;
    const started = performance.now();
    while (true) {
      const input = encoder.encode(`${challenge.prefix}${nonce}`);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
      if (zeroBits(digest) >= challenge.difficulty_bits) return String(nonce);
      nonce += 1;
      if (nonce % 250 === 0) {
        const elapsed = Math.max(1, performance.now() - started);
        setStatus('join-status', `Computing single-use proof… ${Math.round(nonce / elapsed * 1000).toLocaleString()} tries/s`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  async function join() {
    if ($('consent-text').value !== CONSENT) {
      setStatus('join-status', `Type the exact consent sentence: ${CONSENT}`, 'error');
      $('consent-text').focus();
      return;
    }
    const button = $('join-seat');
    button.disabled = true;
    $('receipt-actions').hidden = true;
    state.receipt = null;
    try {
      const payload = joinPayload();
      setStatus('join-status', 'Requesting a five-minute, payload-bound challenge…');
      const challenge = await api('/challenge', { method: 'POST', body: { payload } });
      setStatus('join-status', `Computing ${challenge.difficulty_bits}-bit proof without blocking the page…`);
      const nonce = await solvePow(challenge);
      setStatus('join-status', 'Submitting the one explicit enrollment POST…');
      const joined = await api('/seats', { method: 'POST', body: { payload, challenge_id: challenge.challenge_id, nonce } });
      state.receipt = {
        receipt_version: 1,
        seat_id: joined.seat.seat_id,
        leave_token: joined.leave_token,
        registry: `${location.origin}${API}`,
        saved_at: new Date().toISOString(),
        warning: 'The leave token is shown once. Keep it private; it revokes this public seat.',
      };
      $('receipt-seat-id').textContent = joined.seat.seat_id;
      $('receipt-token').textContent = joined.leave_token;
      $('receipt-actions').hidden = false;
      setStatus('join-status', 'Seat explicitly offered. Save the one-time leave receipt now.', 'success');
      await loadSeats(false);
    } catch (error) {
      setStatus('join-status', error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function receiptText() {
    return `${JSON.stringify(state.receipt, null, 2)}\n`;
  }

  async function copyReceipt() {
    if (!state.receipt) return;
    try {
      await navigator.clipboard.writeText(receiptText());
      setStatus('join-status', 'Private leave receipt copied locally. It was not sent anywhere.', 'success');
    } catch {
      setStatus('join-status', 'Clipboard access failed; use Download receipt instead.', 'error');
    }
  }

  function downloadReceipt() {
    if (!state.receipt) return;
    const blob = new Blob([receiptText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `empty-chair-leave-${state.receipt.seat_id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus('join-status', 'Private leave receipt downloaded locally. It was not sent anywhere.', 'success');
  }

  async function leave() {
    const button = $('leave-seat');
    button.disabled = true;
    try {
      setStatus('leave-status', 'Revoking the public seat…');
      await api('/leave', {
        method: 'POST',
        body: { seat_id: $('leave-seat-id').value.trim(), leave_token: $('leave-token').value.trim() },
      });
      $('leave-seat-id').value = '';
      $('leave-token').value = '';
      setStatus('leave-status', 'Seat removed. Its public and enrollment fields are gone.', 'success');
      await loadSeats(false);
    } catch (error) {
      setStatus('leave-status', error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  $('join-seat').addEventListener('click', join);
  $('copy-receipt').addEventListener('click', copyReceipt);
  $('download-receipt').addEventListener('click', downloadReceipt);
  $('leave-seat').addEventListener('click', leave);
  $('load-more-seats').addEventListener('click', () => loadSeats(true));
  loadSeats(false);
})();
