#!/bin/sh

# Keep the provider's stdin attached to the worker. This launcher must never
# consume, copy, or persist the raw hook envelope.
#
# This boundary begins only after the provider-started /bin/sh is running this
# file. Loader variables can affect that interpreter before these commands run.
# Codex command hooks also pass command strings through the user's login shell
# first. Those provider/user startup paths remain documented trusted boundaries.

# Once this file is running, do not pass known injection variables into any
# external process, including the fail-open warning path and alpha runtime.
unset NODE_OPTIONS
unset NODE_PATH
unset OPENSSL_CONF
unset DYLD_INSERT_LIBRARIES
unset DYLD_LIBRARY_PATH
unset DYLD_FRAMEWORK_PATH
unset DYLD_FALLBACK_LIBRARY_PATH
unset DYLD_FALLBACK_FRAMEWORK_PATH
unset LD_PRELOAD
unset LD_LIBRARY_PATH

warn_unchecked() {
  /usr/bin/printf '%s\n' \
    'AWF hook failed open: this event was not checked.' >&2
}

fail_open() {
  warn_unchecked
  /usr/bin/printf '%s\n' '{}'
  exit 0
}

plugin_root=${1-}
case "$plugin_root" in
  /*) ;;
  *) fail_open ;;
esac

awf_darwin=false
if [ -x /usr/bin/uname ] &&
  [ "$(/usr/bin/uname -s 2>/dev/null)" = Darwin ]
then
  awf_darwin=true
fi

secure_regular_file() {
  file_to_check=$1
  executable_required=$2
  if [ ! -f "$file_to_check" ] || [ -L "$file_to_check" ]; then
    return 1
  fi
  if [ "$executable_required" = true ] && [ ! -x "$file_to_check" ]; then
    return 1
  fi
  if [ "$awf_darwin" = true ]; then
    if [ ! -O "$file_to_check" ]; then
      return 1
    fi
    file_mode=$(/usr/bin/stat -f '%Lp' "$file_to_check" 2>/dev/null) ||
      return 1
    case "$file_mode" in
      *[2367][0-7]|*[0-7][2367]) return 1 ;;
    esac
  fi
  return 0
}

secure_directory() {
  directory_to_check=$1
  if [ ! -d "$directory_to_check" ] ||
    [ -L "$directory_to_check" ]
  then
    return 1
  fi
  if [ "$awf_darwin" = true ]; then
    if [ ! -O "$directory_to_check" ]; then
      return 1
    fi
    file_mode=$(/usr/bin/stat -f '%Lp' "$directory_to_check" 2>/dev/null) ||
      return 1
    case "$file_mode" in
      *[2367][0-7]|*[0-7][2367]) return 1 ;;
    esac
  fi
  return 0
}

worker="$plugin_root/scripts/hook.mjs"
if ! secure_regular_file "$worker" false; then
  fail_open
fi

run_native_with() {
  native_candidate=$1
  native_provider=$2
  if ! secure_regular_file "$native_candidate" true; then
    return 1
  fi

  "$native_candidate" \
    hook \
    --protocol 1 \
    --provider "$native_provider" \
    --plugin-root "$plugin_root"
  native_status=$?
  if [ "$native_status" -ne 0 ]; then
    # The helper may already have written a response. Never append another
    # JSON object or retry the event through the portable runtime.
    warn_unchecked
  fi
  exit 0
}

# A signed app release installs its fixed, versioned integration beneath the
# current user's Application Support directory. An absent or unsafe install
# keeps the checkout-compatible portable path available.
if [ "$awf_darwin" = true ]; then
  native_provider=
  if [ "${PLUGIN_ROOT-}" = "$plugin_root" ] &&
    [ "${CLAUDE_PLUGIN_ROOT-}" != "$plugin_root" ]
  then
    native_provider=codex
  elif [ "${CLAUDE_PLUGIN_ROOT-}" = "$plugin_root" ] &&
    [ "${PLUGIN_ROOT-}" != "$plugin_root" ]
  then
    native_provider=claude
  fi
  case "${HOME-}" in
    /*)
      native_integration_root="$HOME/Library/Application Support/io.github.thisisun.agent-waste-firewall/integration-v1"
      native_launcher="$native_integration_root/awf-hook"
      if secure_directory "$native_integration_root" &&
        [ -n "$native_provider" ]
      then
        run_native_with "$native_launcher" "$native_provider"
      fi
      ;;
  esac
fi

run_with() {
  candidate=$1
  case "$candidate" in
    /*) ;;
    *) return 1 ;;
  esac
  if ! secure_regular_file "$candidate" true; then
    return 1
  fi

  "$candidate" "$worker"
  worker_status=$?
  if [ "$worker_status" -ne 0 ]; then
    # The worker may already have written a response. Never append a second
    # JSON object after stdin has been handed to it.
    warn_unchecked
    exit 0
  fi
  exit 0
}

valid_version_component() {
  component=$1
  case "$component" in
    ""|*[!0-9]*|???????*) return 1 ;;
    0|[1-9]|[1-9][0-9]*) return 0 ;;
    *) return 1 ;;
  esac
}

# This is an alpha external-runtime fallback, not the public release runtime
# contract. The developer override is explicit and absolute. Remaining
# candidates are a small, audited macOS-first allowlist; inherited PATH is
# never searched.
case "${AWF_NODE_PATH-}" in
  /*) run_with "$AWF_NODE_PATH" ;;
esac

case "${HOME-}" in
  /*)
    run_with "$HOME/.volta/bin/node"
    run_with "$HOME/.nvm/current/bin/node"
    nvm_prefix="$HOME/.nvm/versions/node/"
    case "${NVM_BIN-}" in
      "$nvm_prefix"*/bin)
        nvm_version=${NVM_BIN#"$nvm_prefix"}
        nvm_version=${nvm_version%/bin}
        case "$nvm_version" in
          v[0-9]*)
            case "$nvm_version" in
              */*) ;;
              *) run_with "$NVM_BIN/node" ;;
            esac
            ;;
        esac
        ;;
    esac

    # Finder-launched providers commonly have HOME but no NVM_BIN. Inspect at
    # most 64 strict vX.Y.Z directories and choose the newest numeric version
    # without executing shell startup files or inherited PATH commands.
    nvm_scanned=0
    nvm_best=
    nvm_best_major=0
    nvm_best_minor=0
    nvm_best_patch=0
    for nvm_candidate in \
      "$HOME"/.nvm/versions/node/v*.*.*/bin/node
    do
      if [ "$nvm_scanned" -ge 64 ]; then
        break
      fi
      nvm_scanned=$((nvm_scanned + 1))
      if [ ! -f "$nvm_candidate" ] || [ ! -x "$nvm_candidate" ]; then
        continue
      fi
      nvm_version_dir=${nvm_candidate%/bin/node}
      nvm_version_name=${nvm_version_dir##*/}
      nvm_version=${nvm_version_name#v}
      case "$nvm_version" in
        ""|*[!0-9.]*|.*|*..*|*.) continue ;;
      esac
      nvm_major=${nvm_version%%.*}
      nvm_remainder=${nvm_version#*.}
      if [ "$nvm_remainder" = "$nvm_version" ]; then
        continue
      fi
      nvm_minor=${nvm_remainder%%.*}
      nvm_patch=${nvm_remainder#*.}
      if [ "$nvm_patch" = "$nvm_remainder" ]; then
        continue
      fi
      case "$nvm_patch" in
        *.*) continue ;;
      esac
      if ! valid_version_component "$nvm_major" ||
        ! valid_version_component "$nvm_minor" ||
        ! valid_version_component "$nvm_patch" ||
        [ "$nvm_major" -lt 18 ]
      then
        continue
      fi

      nvm_choose=false
      if [ "$nvm_major" -gt "$nvm_best_major" ]; then
        nvm_choose=true
      elif [ "$nvm_major" -eq "$nvm_best_major" ]; then
        if [ "$nvm_minor" -gt "$nvm_best_minor" ]; then
          nvm_choose=true
        elif [ "$nvm_minor" -eq "$nvm_best_minor" ] &&
          [ "$nvm_patch" -gt "$nvm_best_patch" ]
        then
          nvm_choose=true
        fi
      fi
      if [ "$nvm_choose" = true ]; then
        nvm_best=$nvm_candidate
        nvm_best_major=$nvm_major
        nvm_best_minor=$nvm_minor
        nvm_best_patch=$nvm_patch
      fi
    done
    if [ -n "$nvm_best" ]; then
      run_with "$nvm_best"
    fi
    ;;
esac

fail_open
