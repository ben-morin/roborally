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

modalAlert = function(bodyText) {
    if (bodyText) {
        jQuery("#notification-modal .modal-body p").text(bodyText);
    }

    var notificationModal = jQuery("#notification-modal");

    notificationModal.find('.cancel-button').hide();
    notificationModal.off('click', '.confirm-button')
        .off('click', '.cancel-button')
        .off('hidden.bs.modal')
        .off('keydown');

    return new Promise(function (resolve) {
        notificationModal.on('click', '.confirm-button', function () {
            notificationModal.modal('hide');
        });

        notificationModal.on('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                notificationModal.modal('hide');
            }
        });

        notificationModal.on('hidden.bs.modal', function () {
            notificationModal.find('.cancel-button').show();
            resolve(true);
        });

        notificationModal.modal('show');
    });
};

modalConfirm = function(bodyText) {
    if (bodyText) {
        jQuery("#notification-modal .modal-body p").text(bodyText);
    }

    var notificationModal = jQuery("#notification-modal");
    var confirmed = false;

    notificationModal.off('click', '.confirm-button')
        .off('click', '.cancel-button')
        .off('hidden.bs.modal')
        .off('keydown');

    return new Promise(function (resolve) {
        notificationModal.on('click', '.confirm-button', function () {
            confirmed = true;
            notificationModal.modal('hide');
        });

        notificationModal.on('click', '.cancel-button', function () {
            notificationModal.modal('hide');
        });

        notificationModal.on('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmed = true;
                notificationModal.modal('hide');
            }
        });

        notificationModal.on('hidden.bs.modal', function () {
            resolve(confirmed);
        });

        notificationModal.modal('show');
    });
};
