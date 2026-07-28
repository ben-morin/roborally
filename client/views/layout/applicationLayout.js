// applicationLayout.html includes {{> usersPill}}.
import '../users/users.js';
import './applicationLayout.html';

Template.applicationLayout.onRendered(function () {
  // Closes the Responsive Menu on Menu Item Click
  document.querySelectorAll('.navbar-collapse ul li a').forEach((link) => {
    link.addEventListener('click', () => {
      const toggler = document.querySelector('.navbar-toggler');
      if (toggler && toggler.offsetParent !== null) toggler.click();
    });
  });
});

Template.applicationLayout.helpers({
  loggingIn() {
    const user = Meteor.user();
    return user != null;
  },
  appHash() {
    const hash = Meteor.gitCommitHash;
    if (typeof hash !== 'undefined' && hash) return hash;
    else return '';
  },
  appVersion() {
    return Meteor.settings.public?.appVersion || 'development';
  },
});
