#!/usr/bin/env sh
set -e

# application version...


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