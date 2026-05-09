/*
  <!-- confirmation modal -->
  <div id="notification-modal" class="modal fade" data-bs-backdrop="static" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-body">
          <p></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary cancel-button" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary confirm-button">Ok</button>
        </div>
      </div>
    </div>
  </div>

  // Template.events...
  'click .test-button1': async function(event) {
    if (await modalConfirm("modal confirm")) {
      confirm("You clicked OK");
    } else {
      confirm("You clicked Cancel");
    }
  }
*/

modalAlert = function (bodyText) {
  if (bodyText) {
    document.querySelector('#notification-modal .modal-body p').textContent = bodyText;
  }

  const modalEl = document.getElementById('notification-modal');
  const cancelBtn = modalEl.querySelector('.cancel-button');
  cancelBtn.style.display = 'none';

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  return new Promise(function (resolve) {
    const onClick = function (e) {
      if (e.target.closest('.confirm-button')) modal.hide();
    };
    const onKeydown = function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        modal.hide();
      }
    };
    const onHidden = function () {
      modalEl.removeEventListener('click', onClick);
      modalEl.removeEventListener('keydown', onKeydown);
      cancelBtn.style.display = '';
      resolve(true);
    };

    modalEl.addEventListener('click', onClick);
    modalEl.addEventListener('keydown', onKeydown);
    modalEl.addEventListener('hidden.bs.modal', onHidden, { once: true });
    modal.show();
  });
};

modalConfirm = function (bodyText) {
  if (bodyText) {
    document.querySelector('#notification-modal .modal-body p').textContent = bodyText;
  }

  const modalEl = document.getElementById('notification-modal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  let confirmed = false;

  return new Promise(function (resolve) {
    const onClick = function (e) {
      if (e.target.closest('.confirm-button')) {
        confirmed = true;
        modal.hide();
      } else if (e.target.closest('.cancel-button')) {
        modal.hide();
      }
    };
    const onKeydown = function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmed = true;
        modal.hide();
      }
    };
    const onHidden = function () {
      modalEl.removeEventListener('click', onClick);
      modalEl.removeEventListener('keydown', onKeydown);
      resolve(confirmed);
    };

    modalEl.addEventListener('click', onClick);
    modalEl.addEventListener('keydown', onKeydown);
    modalEl.addEventListener('hidden.bs.modal', onHidden, { once: true });
    modal.show();
  });
};
