// Patch the existing bridge in place; the distributable contains no bridge credentials.
export function patchBridge(old) {
  if (old.includes("CODE_REVISION = 'r53-chat-phone-all-qq'")) return old;
  let next = old;
  const replace = (a, b) => {
    if (next.split(a).length !== 2) throw Error('旧桥版本不匹配，未修改: ' + a.slice(0, 45));
    next = next.replace(a, b);
  };

  // r50 predates the message-observer integration, so patch its polling loops directly.
  if (old.includes("CODE_REVISION = 'r50'")) {
    replace("export const CODE_REVISION = 'r50'", "export const CODE_REVISION = 'r53-chat-phone-all-qq'");
    replace("        if (!gid) continue\n        seenGroups.add(gid)", [
      "        const phoneInbox = readJson(join(DSH_HOME, 'chat-phone/inbox.json'), {})",
      "        if (!gid || (phoneInbox?.scope?.enabled && phoneInbox.scope.allGroups) || !!phoneInbox?.channels?.[gid]?.sessionId) continue",
      "        seenGroups.add(gid)",
    ].join('\n'));
    replace("    for (const uid of [...ids]) {", [
      "    for (const uid of [...ids]) {",
      "      const phoneInbox = readJson(join(DSH_HOME, 'chat-phone/inbox.json'), {})",
      "      if ((phoneInbox?.scope?.enabled && phoneInbox.scope.friendPrivate) || phoneInbox?.channels?.['private:' + String(uid)]?.sessionId) continue",
    ].join('\n'));
    return next;
  }

  const was52 = old.includes("CODE_REVISION = 'r52-chat-phone-handoff'");
  if (!was52) {
    replace("export const CODE_REVISION = 'r51-observer-preview'", "export const CODE_REVISION = 'r52-chat-phone-handoff'");
    replace("  const observerHome = join(DSH_HOME, 'message-observer')", [
      "  function chatPhoneClaims(gid) {",
      "    const inbox = readJson(join(DSH_HOME, 'chat-phone/inbox.json'), {})",
      "    return !!inbox?.channels?.[String(gid)]?.sessionId",
      "  }",
      "  const observerHome = join(DSH_HOME, 'message-observer')",
    ].join('\n'));
    replace("raw.groups.filter(x => /^\\d{5,12}$/.test(String(x))).map(x => 'qq:group:' + x)", "raw.groups.filter(x => /^\\d{5,12}$/.test(String(x)) && !chatPhoneClaims(x)).map(x => 'qq:group:' + x)");
    replace("        if (!gid) continue\n        seenGroups.add(gid)", "        if (!gid || chatPhoneClaims(gid)) continue\n        seenGroups.add(gid)");
  }
  replace("CODE_REVISION = 'r52-chat-phone-handoff'", "CODE_REVISION = 'r53-chat-phone-all-qq'");
  replace("return !!inbox?.channels?.[String(gid)]?.sessionId", "return !!(inbox?.scope?.enabled && inbox.scope.allGroups) || !!inbox?.channels?.[String(gid)]?.sessionId");
  replace("    for (const uid of [...ids]) {", [
    "    for (const uid of [...ids]) {",
    "      const phoneInbox = readJson(join(DSH_HOME, 'chat-phone/inbox.json'), {})",
    "      if (phoneInbox?.scope?.enabled && phoneInbox.scope.friendPrivate) continue",
  ].join('\n'));
  return next;
}
