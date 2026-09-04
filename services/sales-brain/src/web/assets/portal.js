/*
  YAD Sales Portal — progressive enhancement.
  Everything here is optional: every page renders and every primary action works
  from the server-rendered HTML. This layer adds selection, in-place claiming and
  the account drawer.

  Claim is never optimistic. The server commit is authoritative, so the row only
  changes after the API confirms — a lost race must never leave phantom ownership
  on screen (rep-portal-api-contract.v1.md §19).
*/
(function () {
  'use strict';

  // ------------------------------------------------------------------ toasts --
  var toastHost = document.getElementById('toasts');

  function toast(message, tone) {
    if (!toastHost) return;
    var el = document.createElement('div');
    el.className = 'toast' + (tone ? ' ' + tone : '');
    el.textContent = message;
    toastHost.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity 200ms ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 220);
    }, 4200);
  }

  function api(path, options) {
    return fetch(path, Object.assign({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      credentials: 'same-origin',
    }, options || {})).then(function (response) {
      if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('signed out');
      }
      return response.json().then(function (body) {
        if (!response.ok) throw Object.assign(new Error(body.message || 'Request failed'), { body: body });
        return body;
      });
    });
  }

  // --------------------------------------------------------------- selection --
  var bulkBar = null;

  function selectedIds() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.js-row-select:checked'))
      .map(function (input) { return input.value; });
  }

  function syncSelection() {
    var ids = selectedIds();
    if (!bulkBar) bulkBar = document.getElementById('bulk-bar');
    if (!bulkBar) return;
    bulkBar.hidden = ids.length === 0;
    var label = bulkBar.querySelector('[data-count]');
    if (label) label.textContent = ids.length + (ids.length === 1 ? ' prospect selected' : ' prospects selected');

    Array.prototype.forEach.call(document.querySelectorAll('tr[data-account]'), function (row) {
      var input = row.querySelector('.js-row-select');
      row.classList.toggle('selected', Boolean(input && input.checked));
    });
  }

  document.addEventListener('change', function (event) {
    var target = event.target;
    if (target.classList && target.classList.contains('js-row-select')) syncSelection();
    if (target.id === 'select-all') {
      Array.prototype.forEach.call(document.querySelectorAll('.js-row-select'), function (input) {
        input.checked = target.checked;
      });
      syncSelection();
    }
  });

  // ------------------------------------------------------------------- claim --
  function markRowClaimed(accountId) {
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-account="' + accountId + '"]'),
      function (node) {
        var button = node.querySelector ? node.querySelector('.js-claim') : null;
        if (button) {
          var open = document.createElement('a');
          open.className = 'btn btn-secondary btn-sm';
          open.href = '/accounts/' + accountId;
          open.textContent = 'Open';
          button.replaceWith(open);
        }
        var checkbox = node.querySelector ? node.querySelector('.js-row-select') : null;
        if (checkbox) checkbox.remove();
        var ownerCell = node.querySelector ? node.querySelector('.js-owner') : null;
        if (ownerCell) ownerCell.innerHTML = '<span class="badge badge-owner-you">You</span>';
      },
    );
    syncSelection();
  }

  function showConflict(accountId, ownerName, reason) {
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-account="' + accountId + '"]'),
      function (node) {
        var button = node.querySelector ? node.querySelector('.js-claim') : null;
        if (button) {
          var span = document.createElement('span');
          span.className = 'muted micro';
          span.textContent = reason === 'SUPPRESSED' ? 'Suppressed'
            : reason === 'CLIENT' ? 'Existing client'
            : reason === 'ACTIVE_OPPORTUNITY' ? 'Active opportunity'
            : 'Owned by ' + (ownerName || 'another rep');
          button.replaceWith(span);
        }
        var checkbox = node.querySelector ? node.querySelector('.js-row-select') : null;
        if (checkbox) { checkbox.checked = false; checkbox.remove(); }
      },
    );
    syncSelection();
  }

  function applyResults(results) {
    results.forEach(function (result) {
      if (result.ok) markRowClaimed(result.accountId);
      else showConflict(result.accountId, result.ownerDisplayName, result.reason);
    });
  }

  document.addEventListener('click', function (event) {
    var claimButton = event.target.closest && event.target.closest('.js-claim');
    if (claimButton) {
      event.preventDefault();
      var accountId = claimButton.dataset.account;
      claimButton.disabled = true;
      claimButton.textContent = 'Claiming…';
      api('/api/accounts/' + accountId + '/claim', {
        body: JSON.stringify({ searchContextId: window.__searchContextId || null }),
      }).then(function (result) {
        applyResults([result]);
        if (result.ok) toast('Claimed. It is now in My Prospects.');
        else if (result.reason === 'CLAIM_LIMIT') toast('You have reached your active prospect limit.', 'warn');
        else if (result.reason === 'SUPPRESSED') toast('That company is suppressed and cannot be worked.', 'bad');
        else toast('Already claimed by ' + (result.ownerDisplayName || 'another rep') + '.', 'warn');
      }).catch(function (error) {
        claimButton.disabled = false;
        claimButton.textContent = 'Claim';
        toast(error.message || 'Claim failed.', 'bad');
      });
      return;
    }

    var bulkButton = event.target.closest && event.target.closest('#js-claim-selected');
    if (bulkButton) {
      event.preventDefault();
      var ids = selectedIds();
      if (ids.length === 0) return;
      if (ids.length >= 10 && !window.confirm('Claim ' + ids.length + ' prospects to yourself?')) return;
      bulkButton.disabled = true;
      bulkButton.textContent = 'Claiming…';
      api('/api/accounts/claim-batch', {
        body: JSON.stringify({ accountIds: ids, searchContextId: window.__searchContextId || null }),
      }).then(function (response) {
        applyResults(response.results);
        var message = response.claimed + ' claimed.';
        if (response.conflicts > 0) message += ' ' + response.conflicts + ' were already owned.';
        toast(message, response.conflicts > 0 ? 'warn' : undefined);
      }).catch(function (error) {
        toast(error.message || 'Bulk claim failed.', 'bad');
      }).finally(function () {
        bulkButton.disabled = false;
        bulkButton.textContent = 'Claim to Me';
      });
      return;
    }

    var researchButton = event.target.closest && event.target.closest('.js-research-more');
    if (researchButton) {
      event.preventDefault();
      researchButton.disabled = true;
      researchButton.textContent = 'Queued…';
      api('/api/mining/jobs', { body: JSON.stringify(window.__searchRequest || {}) })
        .then(function (response) {
          toast(response.created
            ? 'Research queued. Existing results stay available while it runs.'
            : 'Research for this market is already running.');
        })
        .catch(function (error) {
          researchButton.disabled = false;
          researchButton.textContent = 'Research more';
          toast(error.message || 'Could not queue research.', 'bad');
        });
      return;
    }

    var drawerLink = event.target.closest && event.target.closest('.js-open-drawer');
    if (drawerLink) {
      event.preventDefault();
      openDrawer(drawerLink.dataset.account);
    }
  });

  // ------------------------------------------------------------------ drawer --
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('drawer-scrim');
  var drawerBody = document.getElementById('drawer-body');
  var drawerHead = document.getElementById('drawer-head-content');
  var lastFocused = null;

  function openDrawer(accountId) {
    if (!drawer || !drawerBody) return;
    lastFocused = document.activeElement;
    drawerBody.innerHTML = '<p class="muted">Loading…</p>';
    if (drawerHead) drawerHead.innerHTML = '';
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (scrim) scrim.classList.add('open');

    fetch('/accounts/' + accountId + '/panel', { credentials: 'same-origin' })
      .then(function (response) { return response.text(); })
      .then(function (markup) {
        drawerBody.innerHTML = markup;
        var head = drawerBody.querySelector('[data-drawer-head]');
        if (head && drawerHead) { drawerHead.innerHTML = head.innerHTML; head.remove(); }
        var closeButton = document.getElementById('drawer-close');
        if (closeButton) closeButton.focus();
      })
      .catch(function () { drawerBody.innerHTML = '<p class="muted">Could not load this account.</p>'; });
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (scrim) scrim.classList.remove('open');
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  if (scrim) scrim.addEventListener('click', closeDrawer);
  var closeBtn = document.getElementById('drawer-close');
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && drawer && drawer.classList.contains('open')) closeDrawer();
  });

  // ------------------------------------------------------------ copy to clip --
  document.addEventListener('click', function (event) {
    var copyButton = event.target.closest && event.target.closest('.js-copy');
    if (!copyButton) return;
    event.preventDefault();
    var value = copyButton.dataset.value || '';
    var done = function () { toast('Copied ' + value); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(function () { toast('Could not copy.', 'bad'); });
    } else {
      var scratch = document.createElement('textarea');
      scratch.value = value;
      document.body.appendChild(scratch);
      scratch.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy.', 'bad'); }
      scratch.remove();
    }
  });

  // ------------------------------------------------------- disposition form --
  document.addEventListener('change', function (event) {
    if (event.target.name !== 'disposition') return;
    var form = event.target.closest('form');
    if (!form) return;
    var value = event.target.value;
    var callbackFields = form.querySelector('[data-when="CALLBACK_REQUESTED"]');
    if (callbackFields) callbackFields.hidden = value !== 'CALLBACK_REQUESTED';
    var endpointFields = form.querySelector('[data-when="WRONG_NUMBER"]');
    if (endpointFields) endpointFields.hidden = value !== 'WRONG_NUMBER';
    var dncWarning = form.querySelector('[data-when="DO_NOT_CONTACT"]');
    if (dncWarning) dncWarning.hidden = value !== 'DO_NOT_CONTACT';
  });

  // DNC is permanent for ordinary reps, so it always gets an explicit confirmation.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form.classList || !form.classList.contains('js-disposition-form')) return;
    var selected = form.querySelector('[name="disposition"]:checked') || form.querySelector('[name="disposition"]');
    if (selected && selected.value === 'DO_NOT_CONTACT') {
      var ok = window.confirm(
        'Mark this company Do Not Contact?\n\n' +
        'This suppresses the company across every channel and removes it from inventory. ' +
        'You will not be able to undo it yourself.',
      );
      if (!ok) event.preventDefault();
    }
  });

  syncSelection();
})();
