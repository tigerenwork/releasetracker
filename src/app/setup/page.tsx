import { Puzzle, Terminal, Plug, Download, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Keep these in sync with extension/manifest.json and agent/package.json.
// Bump them whenever the extension zip is regenerated (npm run zip:extension)
// or a new agent version is published.
const EXTENSION_VERSION = '1.0.5';
const AGENT_PACKAGE = '@tigerenwork/agent';
const AGENT_VERSION = '1.4.0';

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
        {n}
      </span>
      <div className="flex-1 min-w-0 text-sm text-slate-700 pt-0.5">{children}</div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.85em] font-mono text-slate-800">
      {children}
    </code>
  );
}

function CommandBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 font-mono">
      {children}
    </pre>
  );
}

export default function SetupPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Setup &amp; Downloads</h1>
        <p className="text-slate-600 mt-1">
          Install the Chrome extension and the local agent to connect this app to your machine
        </p>
      </div>

      {/* Chrome Extension */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <Puzzle className="w-5 h-5 text-blue-600" />
            <CardTitle>Chrome Extension</CardTitle>
            <Badge variant="secondary">v{EXTENSION_VERSION}</Badge>
          </div>
          <Button asChild>
            <a href="/downloads/release-tracker-extension.zip" download>
              <Download className="w-4 h-4" />
              Download Extension
            </a>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            The extension is not published to the Chrome Web Store, so it must be loaded
            manually in developer mode:
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Download and unzip <Code>release-tracker-extension.zip</Code> to a folder you
              can keep around (Chrome loads it from that folder — don&apos;t delete it).
            </Step>
            <Step n={2}>
              Open <Code>chrome://extensions</Code> in Chrome.
            </Step>
            <Step n={3}>
              Enable <strong>Developer mode</strong> using the toggle in the top-right corner.
            </Step>
            <Step n={4}>
              Click <strong>Load unpacked</strong> and select the unzipped extension folder.
            </Step>
            <Step n={5}>
              Pin <strong>Release Tracker Agent Bridge</strong> to the toolbar via the puzzle
              icon, so you can open its popup for the connection step below.
            </Step>
          </ol>
        </CardContent>
      </Card>

      {/* rt-agent */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-blue-600" />
            <CardTitle>rt-agent (local execution agent)</CardTitle>
            <Badge variant="secondary">
              {AGENT_PACKAGE} v{AGENT_VERSION}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            Prerequisites: <strong>Node.js 18+</strong> and <Code>kubectl</Code> configured
            with your cluster contexts. The agent is a private package hosted on GitHub
            Packages.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Point npm at the GitHub Packages registry and authenticate. Create a GitHub
              personal access token (classic) with the <Code>read:packages</Code> scope, then:
              <CommandBlock>
                {`printf '\\n@tigerenwork:registry=https://npm.pkg.github.com\\n//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN\\n' >> ~/.npmrc`}
              </CommandBlock>
            </Step>
            <Step n={2}>
              Install the agent globally:
              <CommandBlock>{`npm i -g ${AGENT_PACKAGE}`}</CommandBlock>
            </Step>
            <Step n={3}>
              Install the autostart service (launchd on macOS, systemd on Linux) and start the
              agent:
              <CommandBlock>{`rt-agent install`}</CommandBlock>
              This prints your <strong>agent token</strong> — copy it. You can retrieve it again
              anytime with <Code>rt-agent token</Code>. Other useful commands:{' '}
              <Code>rt-agent status</Code>, <Code>rt-agent start</Code>,{' '}
              <Code>rt-agent uninstall</Code>.
            </Step>
          </ol>
        </CardContent>
      </Card>

      {/* Connect */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <Plug className="w-5 h-5 text-blue-600" />
          <CardTitle>Connect the extension to the agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3">
            <Step n={1}>
              Click the <strong>Release Tracker Agent Bridge</strong> extension icon in the
              Chrome toolbar to open its popup.
            </Step>
            <Step n={2}>
              Paste the agent token from <Code>rt-agent install</Code> (or{' '}
              <Code>rt-agent token</Code>) into the token field and save.
            </Step>
            <Step n={3}>
              The agent listens on <Code>http://127.0.0.1:3456</Code> by default. Verify the
              popup shows a connected status, then reload this page.
            </Step>
          </ol>
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Once connected, release actions in this app are executed by the agent on your
            machine.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
