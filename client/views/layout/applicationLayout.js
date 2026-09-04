// applicationLayout.html includes {{> usersPill}}.
import '../users/users.js';
import './applicationLayout.html';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountsMenu } from '../accounts/AccountsMenu.tsx';

Template.applicationLayout.onRendered(function () {
  // The app's one React root, hosted by Blaze until P8 turns that round. It belongs here
  // because FlowRouter re-renders the layout only when the layout name changes, and every
  // route uses this one — so the root is created once and lives for the session.
  this.accountsRoot = createRoot(this.find('#login-buttons'));
  this.accountsRoot.render(createElement(AccountsMenu));

  // Closes the Responsive Menu on Menu Item Click
  document.querySelectorAll('.navbar-collapse ul li a').forEach((link) => {
    link.addEventListener('click', () => {
      const toggler = document.querySelector('.navbar-toggler');
      if (toggler && toggler.offsetParent !== null) toggler.click();
    });
  });
});

Template.applicationLayout.onDestroyed(function () {
  this.accountsRoot?.unmount();
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
