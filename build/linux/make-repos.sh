#!/usr/bin/env bash
# Adds Linux packages to WorkSuite Office's signed APT and RPM repositories (UPD-05, UPD-06, G-02/G-03).
#   build/linux/make-repos.sh <repository tree> <stable|beta> <package.deb|package.rpm>...
# The tree is what https://download.worksuitecloud.com/linux/ serves (build/README.md, "Linux repositories"):
#   worksuite-office.gpg, worksuite-office.asc        the signing key (binary keyring and armoured)
#   apt/pool/<channel>/w/<name>/<file>.deb            packages
#   apt/dists/<channel>/{Release,Release.gpg,InRelease} and main/binary-amd64/Packages{,.gz}
#   rpm/<channel>/x86_64/<file>.rpm + repodata/       (repomd.xml.asc beside repomd.xml)
#   rpm/worksuite-office-<channel>.repo                the dnf/zypper repository file
# Packages already in the tree stay (earlier versions remain installable); the metadata is made again
# and signed. The key is the secret key in GPG's default keyring (import it first); GPG_KEY_ID picks one
# when there are several, GPG_PASSPHRASE unlocks it.
set -euo pipefail
tree="$1" channel="$2"; shift 2
base_url="${LINUX_REPO_URL:-https://download.worksuitecloud.com/linux}"
fail() { echo "::error::$*"; exit 1; }
[[ "$channel" =~ ^(stable|beta)$ ]] || fail "channel must be stable or beta"
[ "$#" -gt 0 ] || fail "give the .deb and .rpm files"
for t in gpg apt-ftparchive dpkg-deb createrepo_c rpmsign; do command -v "$t" >/dev/null || fail "$t is missing"; done

key="${GPG_KEY_ID:-$(gpg --batch --list-secret-keys --with-colons | awk -F: '$1=="sec"{print $5; exit}')}"
[ -n "$key" ] || fail "no GPG secret key: import LINUX_REPO_GPG_PRIVATE_KEY first"
gpgs=(gpg --batch --yes --pinentry-mode loopback --local-user "$key")
[ -z "${GPG_PASSPHRASE:-}" ] || gpgs+=(--passphrase "$GPG_PASSPHRASE")

mkdir -p "$tree"
tree="$(cd "$tree" && pwd)"
gpg --batch --yes --export "$key" > "$tree/worksuite-office.gpg"
gpg --batch --yes --armor --export "$key" > "$tree/worksuite-office.asc"

debs=0 rpms=0
for f in "$@"; do
  case "$f" in
    *.deb)
      name="$(dpkg-deb -f "$f" Package)"
      d="$tree/apt/pool/$channel/${name:0:1}/$name"
      mkdir -p "$d" && cp -f "$f" "$d/"; debs=$((debs + 1)) ;;
    *.rpm)
      mkdir -p "$tree/rpm/$channel/x86_64"
      cp -f "$f" "$tree/rpm/$channel/x86_64/"
      # the package itself is signed too, for gpgcheck=1
      rpmsign --addsign --define "_gpg_name $key" --define "__gpg $(command -v gpg)" \
        --define "_gpg_sign_cmd_extra_args --batch --pinentry-mode loopback${GPG_PASSPHRASE:+ --passphrase $GPG_PASSPHRASE}" \
        "$tree/rpm/$channel/x86_64/$(basename "$f")" >/dev/null
      rpms=$((rpms + 1)) ;;
    *) fail "$f is neither a .deb nor an .rpm" ;;
  esac
done

if [ -d "$tree/apt/pool/$channel" ]; then
  ( cd "$tree/apt"
    bin="dists/$channel/main/binary-amd64"
    mkdir -p "$bin"
    apt-ftparchive packages "pool/$channel" > "$bin/Packages"
    gzip -9nkf "$bin/Packages"
    apt-ftparchive \
      -o APT::FTPArchive::Release::Origin=WorkSuite -o APT::FTPArchive::Release::Label="WorkSuite Office" \
      -o APT::FTPArchive::Release::Suite="$channel" -o APT::FTPArchive::Release::Codename="$channel" \
      -o APT::FTPArchive::Release::Architectures=amd64 -o APT::FTPArchive::Release::Components=main \
      release "dists/$channel" > "dists/$channel/Release.new"
    mv -f "dists/$channel/Release.new" "dists/$channel/Release"
    "${gpgs[@]}" --clearsign -o "dists/$channel/InRelease" "dists/$channel/Release"
    "${gpgs[@]}" --armor --detach-sign -o "dists/$channel/Release.gpg" "dists/$channel/Release" )
  gpg --batch --no-default-keyring --keyring "$tree/worksuite-office.gpg" --verify "$tree/apt/dists/$channel/InRelease" 2>/dev/null \
    || fail "InRelease does not verify against worksuite-office.gpg"
fi

if [ -d "$tree/rpm/$channel/x86_64" ]; then
  r="$tree/rpm/$channel/x86_64"
  createrepo_c --quiet --update "$r"
  "${gpgs[@]}" --armor --detach-sign -o "$r/repodata/repomd.xml.asc" "$r/repodata/repomd.xml"
  cat > "$tree/rpm/worksuite-office-$channel.repo" <<EOF
[worksuite-office-$channel]
name=WorkSuite Office ($channel)
baseurl=$base_url/rpm/$channel/x86_64
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=$base_url/worksuite-office.asc
EOF
fi
echo "$channel: $debs .deb and $rpms .rpm added, signed with $key"
