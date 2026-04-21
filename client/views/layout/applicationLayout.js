Template.applicationLayout.onRendered(function () {
  // Closes the Responsive Menu on Menu Item Click
  $('.navbar-collapse ul li a').click(function () {
    $('.navbar-toggler:visible').click();
  });
});

Template.applicationLayout.helpers({
  loggingIn: function () {
    var user = Meteor.user();
    return user != null;
  },
  appHash: function () {
    const hash = Meteor.gitCommitHash;
    if (typeof hash !== 'undefined' && hash)
      return hash;
    else
      return '';
  },
  appVersion: function () {
    return Meteor.settings.public?.appVersion || 'development';
  },
});
