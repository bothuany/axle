# Homebrew cask for Axle, for a future tap repository bothuany/homebrew-tap (Casks/axle.rb). Not published yet: see
# packaging/README.md. The sha256 values are the release's SHA256SUMS.txt lines for the two .zip files.
#   brew install --cask bothuany/tap/axle
cask "axle" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/bothuany/axle/releases/download/v#{version}/Axle-#{version}-darwin-#{arch}.zip"
  name "Axle"
  desc "Harness-first code editor with a call-flow canvas and terminal agents"
  homepage "https://github.com/bothuany/axle"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Axle.app"
  # VS Code's build names the macOS launcher script bin/code; on PATH it is `axle`.
  binary "#{appdir}/Axle.app/Contents/Resources/app/bin/code", target: "axle"

  zap trash: [
    "~/.axle",
    "~/Library/Application Support/Axle",
    "~/Library/Preferences/io.github.bothuany.axle.plist",
    "~/Library/Saved Application State/io.github.bothuany.axle.savedState",
  ]

  caveats <<~EOS
    Axle is not signed with an Apple Developer ID yet, so macOS blocks its first launch.
    Open it once, then choose System Settings > Privacy & Security > Open Anyway.
    If macOS says the app is damaged, clear the download quarantine instead:
      xattr -dr com.apple.quarantine "#{appdir}/Axle.app"
  EOS
end
