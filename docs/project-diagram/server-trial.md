# Real-server trial: Project, Diagram and Office Pro licences

The last item on the roadmap. Each piece below has been tried against stand-ins only; this is the script for
trying them end to end on a real WorkSuite server and the real Update Center. Work through it in order, tick each
box, and write down anything that differs from "Expect" with the file you used.

You need: a WorkSuite server (worksuite `main`), the Update Center (worksite-download `main`), a desktop build of
WorkSuite Office 10.1.114 or later, two WorkSuite accounts (A and B) in the same company, and two browsers.

## 0. Before you start

- [ ] **WorkSuite server:** `php spark migrate --all`. Expect `CreateProjectDriveFiles` and `DiagramSourceFile`
      among the migrations run, and no errors.
- [ ] **Update Center:** `php spark migrate` then `php spark db:seed RbacSeeder`. Expect `CreateOfficeLicenses`
      to run, and **Office › Licences** in the admin menu for a super admin.
- [ ] **Licence key:** create the licence signing key in the Update Center key provider and set
      `updatecenter.licenseKeyId`. `GET https://download.worksuitecloud.com/api/v1/license/keys` returns it.
- [ ] **Desktop build:** the build either has that public key in `BUILTIN_LICENSE_KEYS` (10.1.115 or later) or is
      started with `WS_AI_LICENSE_KEYS` set to it. Without one of the two, step 3 ends in "invalid licence".

## 1. Project online

Files: a `.wsproj` saved by the desktop Project app (with a summary task, a milestone, links, a resource), and a
Microsoft Project XML file (`.xml`) saved from Microsoft Project.

- [ ] A uploads the `.wsproj` to Drive and opens it. Expect it to open as a project (`POST /api/projects/open-file/{id}`),
      with the same tasks, dates, links and resources as on the desktop.
- [ ] A opens the same file again. Expect the same project, not a second copy.
- [ ] A shares the project with B. Both open it; A moves a task. Expect B to see the change without reloading.
- [ ] B changes a duration and A uses **Save to Drive**. Expect a new Drive version of the `.wsproj`; open it in
      the desktop app and see B's duration.
- [ ] Repeat the first and fourth steps with the Project XML file. Expect it to open, and to save back as Project XML
      that Microsoft Project opens without a repair prompt.
- [ ] Open an `.mpp` in the desktop Project app. Expect a message explaining how to save it as Project XML in
      Microsoft Project. Online, opening one from Drive should refuse it with a message, not an error page.

## 2. Diagram online

Files: a `.wsdiagram` saved by the desktop Diagram app, and a Visio `.vsdx` with several pages, connectors and a picture.

- [ ] A opens the `.wsdiagram` from Drive. Expect the online editor, with its shapes and connectors.
- [ ] A and B edit it together; within about 10 minutes, or after **Drive › Write it now**, expect a new Drive
      version of the `.wsdiagram` that opens on the desktop with both people's edits.
- [ ] A opens the `.vsdx`. Expect an online copy, with "Not shown online: …" in the activity naming the picture.
      The `.vsdx` in Drive is unchanged (same version count).
- [ ] B opens the same `.vsdx` from Drive. Expect A's diagram (if shared with B), not a new copy.
- [ ] A uses **Drive › Save into the Visio file…**. Expect the warning first; after **Save into it**, a new Drive
      version of the `.vsdx` that opens in Visio and in the desktop Diagram app. The previous version is still
      in the file's history.
- [ ] A switches the Drive format to SVG. Expect a separate `.svg` file; the `.vsdx` keeps its last Visio version.
- [ ] B, who can view but not edit the `.vsdx` in Drive, tries **Save into the Visio file…**. Expect
      "You cannot change the Visio file this diagram was opened from."

## 3. Office Pro licences

- [ ] In the Update Center, **Office › Licences › Issue licence**: 1 seat, all features, no expiry, the customer's
      account email. Expect the `WSO-…` key once, with Copy. Write it down.
- [ ] Desktop, computer 1: **Settings › WorkSuite Office Pro › I have a key**, paste the key, **Activate**. Expect
      the "Starting" then "Contacting" steps, then **Done** with the features listed; Project and Diagram can edit.
- [ ] The admin licence row shows **1 / 1** seats, and **Computers** lists computer 1 with the app version.
- [ ] Computer 2 activates the same key. Expect the wizard to fail with the seats-full message.
- [ ] Customer, in **My account › Office licences**, frees computer 1. Computer 2 activates. Expect **Done**.
- [ ] Computer 2 offline: restart the app. Expect Pro still active (offline licence, 30-day grace).
- [ ] Admin revokes the licence with a reason. Computer 2 uses **Check again**. Expect Pro to end; the audit log
      has the issue, free and revoke entries.
- [ ] A mistyped key (one character changed). Expect the wizard's failure step with a message about the key, not a crash; after 30 tries in 10
      minutes from one address, expect the rate limit.

## 4. Report

For each failed box: what you did, what you expected, what happened, the file (if you can share it), and the
server log lines from that minute (`writable/logs/log-<date>.log` on both servers).
