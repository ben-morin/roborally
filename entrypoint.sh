#!/usr/bin/env sh
set -e

# application version
if [ -f /usr/app/APP_VERSION ]; then
    export APP_VERSION=$(cat /usr/app/APP_VERSION)
elif [ -f /usr/app/package.json ]; then
    export APP_VERSION=$(node -p "require('/usr/app/package.json').version")
fi
echo "APP_VERSION=$APP_VERSION"


# Path to your settings file within the container
SETTINGS_FILE=${SETTINGS_FILE:-"/usr/app/settings.json"}

if [ -n "$METEOR_SETTINGS" ]; then # use the environment variable if it's set
    echo "Using METEOR_SETTINGS from environment variable"
elif [ -f "$SETTINGS_FILE" ]; then # use the settings file if it exists...
    echo "Using METEOR_SETTINGS from $SETTINGS_FILE"
    export METEOR_SETTINGS=$(cat "$SETTINGS_FILE")
else
    echo "No METEOR_SETTINGS provided. Proceeding without it."
fi

exec "$@"