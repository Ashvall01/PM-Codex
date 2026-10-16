"""Re-capture the showcase demo's screens from a real PM Codex build.

The demo on docs/index.html is made of the app's own rendered markup: this script
seeds a fresh browser with the sample project (Atlas ERP Rollout, all invented),
walks the app through the same states the demo shows, and writes the cleaned
markup to docs/_src/captures/. Then `npm run build` in docs/_src.

    # 1. a throwaway build of the app (never your own running copy)
    cd source && npm install && npm run build && PM_CODEX_PORT=7811 node server.mjs
    # 2. capture (Python 3, pip install playwright beautifulsoup4 lxml)
    python3 docs/_src/tools/capture.py http://localhost:7811
    # 3. rebuild the page
    cd docs/_src && npm install && npm run build

Safety: the browser is fresh, the Sheet address is fake and every Google Apps
Script call is blocked, and the bridge socket (port 7799) is refused, so no
Sheet and no Claude session is touched. The browser's clock is pinned to
15 Oct 2026, 09:00, so the "late / in 2 days" labels match the sample.

The app's breakpoints (sm, md, lg, xl, 2xl) are rewritten as container queries
on the demo's frame (#app, `@container/app`), so a captured screen lays itself
out for the width of the frame, as the app would in a window that wide.
"""
import json, os, re, sys, tempfile
from datetime import datetime
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

APP = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7811").rstrip("/")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "captures")
ICONS = os.path.join(HERE, "..", "node_modules", "lucide-static", "icons")
RAW = tempfile.mkdtemp(prefix="pmc-capture-")

# ------------------------------------------------------------------ sample project
P = "p1"
def act(i, phase, a, w, prog, status, owner, s, e, as_="", ae=""):
    return dict(id=f"a{i}", phase=phase, activity=a, subActivity="", weight=w, progress=prog, status=status, owner=owner,
                targetStartDate=s, targetCompletionDate=e, actualStartDate=as_, actualCompletionDate=ae, remarks="")
ACTS = [
    act(1, "1. Discovery", "Requirements workshops", 8, 1, "Completed", "Maya", "2026-08-03", "2026-08-21", "2026-08-03", "2026-08-20"),
    act(2, "1. Discovery", "Process maps signed off", 4, 1, "Completed", "Priya", "2026-08-17", "2026-08-28", "2026-08-17", "2026-08-28"),
    act(3, "2. Design", "Solution design", 8, 1, "Completed With Delay", "Jonas", "2026-08-31", "2026-09-18", "2026-08-31", "2026-09-21"),
    act(4, "2. Design", "Data mapping v2", 6, 0.8, "In Progress", "Priya", "2026-09-14", "2026-10-09", "2026-09-14"),
    act(5, "3. Build", "Configure modules", 14, 0.55, "In Progress", "Jonas", "2026-09-21", "2026-10-30", "2026-09-21"),
    act(6, "3. Build", "Data migration scripts", 10, 0.45, "In Progress", "Rafi", "2026-09-28", "2026-10-30", "2026-10-01"),
    act(7, "3. Build", "Integrations", 8, 0.2, "In Progress", "Rafi", "2026-10-05", "2026-11-06", "2026-10-07"),
    act(8, "4. UAT", "UAT round 1", 10, 0, "Not Started", "Priya", "2026-11-02", "2026-11-13"),
    act(9, "4. UAT", "UAT round 2", 6, 0, "Not Started", "Priya", "2026-11-16", "2026-11-27"),
    act(10, "5. Go-live", "Training", 8, 0.1, "In Progress", "Leo", "2026-10-12", "2026-11-27", "2026-10-12"),
    act(11, "5. Go-live", "Cutover", 6, 0, "Not Started", "Maya", "2026-11-30", "2026-12-04"),
    act(12, "5. Go-live", "Hypercare", 2, 0, "Not Started", "Jonas", "2026-12-07", "2026-12-18"),
]
TS = [1791511920000, 1791790200000, 1791860700000, 1791970800000]  # 9, 12, 13, 14 Oct 2026
COMMENTS = {
    1: ["IT says the accounts are ready on Friday."],
    2: ["Vendor ticket raised.", "Timeout at 5,000 rows.", "Vendor asks for logs.", "Logs sent.", "Waiting on the vendor patch."],
    3: ["Sent v2 to finance.", "Finance has questions on cost centres.", "Review call booked for Thursday."],
    6: ["About 300 duplicates found.", "Rule for merging agreed with Jonas."],
}
def task(i, type_, desc, status, owner, prio, due, flagged=False):
    return dict(id=f"t{i}", projectId=P, type=type_, createdDate=1789000000000 + i, description=desc, status=status, owner=owner,
                remarks="", estimatedResolutionDate=due, source="", priority=prio, isFlagged=flagged, linkedActivityIds=[],
                comments=[dict(id=f"t{i}c{k}", text=t, timestamp=TS[min(k, 3)], author="User") for k, t in enumerate(COMMENTS.get(i, []))])
TASKS = [
    task(1, "Action Item", "Confirm UAT test accounts with IT", "Open", "Rafi", "High", "2026-10-13", True),
    task(2, "Issue", "Vendor sandbox times out on bulk import", "Blocked", "Jonas", "High", "2026-10-19"),
    task(3, "Action Item", "Collect sign-off on data mapping v2", "In Progress", "Priya", "Medium", "2026-10-16"),
    task(4, "Action Item", "Draft the cutover runbook", "Open", "Maya", "Medium", "2026-10-22"),
    task(5, "Action Item", "Book training rooms for week 1", "Done", "Leo", "Low", "2026-10-09"),
    task(6, "Issue", "Duplicate supplier records in legacy export", "In Progress", "Rafi", "Medium", "2026-10-20"),
]
def dl(i, title, status, due, owner, cat="Documents", comments=()):
    return dict(id=f"d{i}", projectId=P, title=title, description="", definitionOfDone="", status=status, dueDate=due, category=cat,
                priority="Medium", owner=owner, parentId=None, linkedActivityIds=[],
                comments=[dict(id=f"d{i}c{k}", text=t, timestamp=TS[0], author="User") for k, t in enumerate(comments)])
DELS = [
    dl(1, "Business requirements", "Signed Off", "2026-08-28", "Maya", comments=["Signed by the sponsor."]),
    dl(2, "Data mapping specification", "In Review", "2026-10-09", "Priya", comments=["Sent to finance for review."]),
    dl(3, "Configured system", "In Progress", "2026-10-30", "Jonas", "System"),
    dl(4, "UAT report", "Pending", "2026-11-27", "Priya"),
    dl(5, "Training kit", "In Progress", "2026-11-20", "Leo"),
    dl(6, "Cutover plan", "Pending", "2026-11-25", "Maya"),
]
def risk(i, desc, imp, prob, val, status, owner):
    return dict(id=f"r{i}", projectId=P, riskId=f"R-{i:02d}", riskDescription=desc, projectSpecificDescription=desc,
                ciaConfidentiality="", ciaIntegrity="", ciaAvailability="", impactArea="Schedule", impactLevel=imp, probability=prob,
                postMitigationImpactLevel="", postMitigationProbability="", riskValue=val, owner=owner, responsibility="",
                mitigationStrategy="", projectSpecificMitigationStrategy="", status=status, targetResolutionDate="2026-11-01",
                remarks="", controlAnnexA="")
RISKS = [
    risk(1, "Key users on year-end leave during UAT", "High", "High", "High", "Open", "Priya"),
    risk(2, "Legacy data quality below migration threshold", "Critical", "Moderate", "High", "Under Mitigation", "Rafi"),
    risk(3, "Vendor patch slips past go-live", "Critical", "Low", "High", "Open", "Jonas"),
    risk(4, "Training not finished before cutover", "Moderate", "Moderate", "Medium", "Open", "Leo"),
    risk(5, "Licence cost above budget", "Low", "Low", "Lowest", "Mitigated", "Maya"),
]
MOMS = [dict(id="m1", projectId=P, title="Weekly steering", date="2026-10-14", time="10:00", location="Room 4B",
             attendees="Maya, Priya, Jonas, Rafi, Leo", agenda="1. Build status\n2. UAT readiness\n3. Risks",
             notes="<p>Build on track except integrations. Finance wants one more mapping review.</p>",
             keyDecisions="<ul><li>Hold go-live on 30 Nov.</li><li>One more mapping review with finance.</li></ul>",
             actionItems=[
                 dict(id="ai1", description="Confirm the UAT window with finance leads", assignee="Priya", status="Open", priority="High", estimatedResolutionDate="2026-10-21"),
                 dict(id="ai2", description="Share the data-quality report", assignee="Rafi", status="In Progress", taskId="t6"),
                 dict(id="ai3", description="Decide on a parallel run for payroll", assignee="Maya", status="Open"),
             ])]
DOCS = [dict(id=f"doc{i}", projectId=P, title=t, url="https://example.com", type=ty, status=st, version=v, owner=o,
             createdAt="2026-09-01T00:00:00Z", updatedAt="2026-10-10T00:00:00Z", description="")
        for i, (t, ty, st, v, o) in enumerate([
            ("Project charter", "Contract", "Approved", "1.2", "Maya"), ("Data mapping specification", "Design", "In Review", "2.0", "Priya"),
            ("UAT test scripts", "Test", "Draft", "0.4", "Priya"), ("Solution design", "Design", "Approved", "1.0", "Jonas"),
            ("Training plan", "Manual", "Draft", "0.2", "Leo")])]
CODEX = [
    dict(id="cx1", projectId=P, title="Project rules", content="", parentId=None, createdAt="2026-09-01", updatedAt="2026-10-01"),
    dict(id="cx2", projectId=P, title="How dates move", parentId="cx1", createdAt="2026-09-01", updatedAt="2026-10-01",
         content="<p>A target date changes only after steering agrees, and the reason goes in the task's remarks.</p><ul><li>Go-live is fixed. Anything that threatens it is a risk, not a new date.</li><li>An issue without an owner gets one within a working day.</li><li>Finance signs off anything that touches the chart of accounts.</li></ul>"),
    dict(id="cx3", projectId=P, title="Who signs off what", content="<p>Finance leads sign off mapping.</p>", parentId="cx1", createdAt="2026-09-01", updatedAt="2026-10-01"),
    dict(id="cx4", projectId=P, title="Decisions", content="", parentId=None, createdAt="2026-09-01", updatedAt="2026-10-01"),
    dict(id="cx5", projectId=P, title="Single go-live, no phased rollout", content="<p>Agreed at kickoff.</p>", parentId="cx4", createdAt="2026-09-01", updatedAt="2026-10-01"),
]
def stk(i, name, role, org, power, interest):
    return dict(id=f"s{i}", projectId=P, name=name, role=role, projectRole=role, orgRole=role, organization=org, email="", phone="",
                power=power, interest=interest, knowledge="Medium", interPersonalRelations="", notes="")
STKS = [stk(1, "Hana", "CFO", "Finance", "High", "Low"), stk(2, "Omar", "Sponsor", "Operations", "High", "High"),
        stk(3, "Finance leads", "Approvers", "Finance", "High", "High"), stk(4, "Vendor PM", "Vendor", "Vendor", "High", "High"),
        stk(5, "Facilities", "Rooms", "Operations", "Low", "Low"), stk(6, "Warehouse supervisors", "Key users", "Supply chain", "Low", "High")]
def ms(i, phase, term, pct, w, d, inv):
    return dict(id=f"b{i}", projectId=P, phase=phase, agreementName="Implementation", agreementNo="AG-0114", agreementLink="", term=term,
                percentage=pct, valueNet=240000 * pct / 100, valueVat=240000 * pct / 100 * 1.11, workStatus=w,
                prerequisiteDocumentStatus=d, documentLink="", invoicingStatus=inv, invoiceLink="", invoiceDate="", remarks="")
BILLS = [ms(1, "Design", "Design sign-off", 30, "Done", "Done", "Done"), ms(2, "Build", "System configured", 40, "In Progress", "Pending", "Pending"),
         ms(3, "Go-live", "Go-live accepted", 30, "Pending", "Pending", "Pending")]
CLAUDE_ACR = dict(id="acr1", sessionId="claude", projectId=P, origin="claude", status="pending", createdAt="2026-10-15T09:00:00Z", changes=[
    dict(id="c1", approved=True, name="updateTask", changeTitle="Move the mapping sign-off to 23 Oct",
         args=dict(id="t3", estimatedResolutionDate="2026-10-23", remarks="Finance asked for one more review round.")),
    dict(id="c2", approved=True, name="addProjectRisk", changeTitle="Add risk: test data not anonymised",
         args=dict(riskId="R-06", riskDescription="Test data not anonymised before UAT",
                   projectSpecificDescription="Test data not anonymised before UAT. If it isn't, UAT waits for a clean extract.",
                   impactArea="Legal", impactLevel="High", probability="Moderate", riskValue="High", owner="Rafi", status="Open")),
    dict(id="c3", approved=True, name="addDeliverableComment", changeTitle="Note the extra review round on the mapping spec",
         args=dict(deliverableId="d2", text="Steering 14 Oct: finance wants one more review round before sign-off.")),
    dict(id="c4", approved=False, name="updateTimelineRow", changeTitle="Data migration scripts: 45% to 55%", args=dict(id="a6", progress=0.55)),
])
GEMINI_ACR = dict(id="acr2", sessionId="sess1", projectId=P, origin="gemini", status="pending", createdAt="2026-10-15T08:01:00Z", changes=[
    dict(id="g1", approved=True, name="flagTask", args=dict(id="t3"), changeTitle="Flag: Collect sign-off on data mapping v2")])
SESSION = dict(id="sess1", projectId=P, title="What needs me today", updatedAt="2026-10-15T08:00:00Z", messages=[
    dict(role="user", parts=[dict(text="What needs me today?")]),
    dict(role="model", parts=[dict(text="Three things are late.")])])

def store(gemini=False):
    w = lambda state: json.dumps({"state": state, "version": 0})
    return {
        "pm-app-storage": w(dict(gasUrl="https://script.google.com/macros/s/sample/exec", activeProjectId=P, timelineColumnWidths={},
                                 lastSyncedAt=None, deletedRecordIds=[], deletedProjectIds=[],
                                 projects=[dict(id=P, name="Atlas ERP Rollout", description="Finance and supply chain on one system by December.", createdAt=1754000000000)])),
        "pm-codex-timeline-storage": w(dict(projectTimelines=[dict(projectId=P, activeRevisionId="rev1", holidays=[],
                                       revisions=[dict(id="rev1", name="Initial Plan", createdAt=1754000000000, activities=ACTS)])])),
        "pm-codex-tasks-storage": w(dict(tasks=TASKS)),
        "pm-codex-deliverables-storage": w(dict(deliverables=DELS)),
        "pm-codex-risks": w(dict(risks=RISKS)),
        "pm-codex-moms": w(dict(moms=MOMS, activeMomId="m1")),
        "pm-codex-acr-storage": w(dict(acrs=[CLAUDE_ACR] + ([GEMINI_ACR] if gemini else []))),
        "pm-codex-documents": w(dict(documents=DOCS)),
        "pm-codex-storage": w(dict(pages=CODEX, activePageId="cx2")),
        "pm-codex-stakeholders": w(dict(stakeholders=STKS)),
        "pm-codex-billing": w(dict(milestones=BILLS, isEnabled=True)),
        "pm-ai-storage": w(dict(sessions=[SESSION] if gemini else [], activeSessionId="sess1" if gemini else None,
                                isSidebarOpen=False, sidebarOpenedByAcr=False)),
    }

# ------------------------------------------------------------------ capture runs
GRAB_TRAY = """() => [...document.querySelectorAll('div.fixed')].filter(el => el.className.includes('right-0') && el.className.includes('top-0')
  && el.getBoundingClientRect().left < window.innerWidth - 5 && el.getBoundingClientRect().width > 100).map(el => el.outerHTML).join('')"""

def run(steps, gemini=False):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        ctx.route("**/script.google.com/**", lambda r: r.abort())
        ctx.route("**/script.googleusercontent.com/**", lambda r: r.abort())
        pg = ctx.new_page()
        pg.clock.install(time=datetime(2026, 10, 15, 9, 0))
        # The bridge socket is answered by nobody, so a running bridge never sees this tab.
        pg.route_web_socket(re.compile(r"ws://(127\.0\.0\.1|localhost):7799.*"), lambda ws: None)
        seed = "".join(f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)});" for k, v in store(gemini).items())
        pg.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ {seed} sessionStorage.setItem('seeded', '1'); }}")
        for st in steps:
            k = st[0]
            if k == "goto":
                pg.goto(f"{APP}/{st[1]}"); pg.wait_for_timeout(2000)
            elif k == "click":
                sel = st[1]
                (pg.get_by_text(sel[5:], exact=False) if sel.startswith("text:") else pg.locator(sel)).first.click()
                pg.wait_for_timeout(1500)
            elif k == "grab":
                open(f"{RAW}/{st[1]}.main.html", "w").write(pg.evaluate("document.querySelector('main').innerHTML"))
                tray = pg.evaluate(GRAB_TRAY)
                if tray:
                    open(f"{RAW}/{st[1]}.tray.html", "w").write(tray)
                print("captured", st[1], flush=True)
        b.close()

def capture():
    run([["goto", "overview"], ["grab", "overview_b"],
         ["goto", "timeline"], ["grab", "timeline_b"],
         ["goto", "deliverables"], ["grab", "deliverables_b"], ["click", "text:Data mapping specification"], ["grab", "deliverables_b_d2"],
         ["goto", "tasks-issues"], ["grab", "tasks_b"], ["click", "text:Collect sign-off on data mapping"], ["grab", "tasks_b_t3"],
         ["goto", "risks"], ["grab", "risks_b"], ["goto", "mom"], ["grab", "mom_b"], ["goto", "stakeholders"], ["grab", "stakeholders_b"],
         ["goto", "documents"], ["grab", "documents_b"], ["goto", "codex"], ["grab", "codex_b"], ["goto", "billing"], ["grab", "billing_b"]])
    run([["goto", "overview"], ["click", "text:Claude has proposed"],
         ["click", "text:Move the mapping sign-off"], ["grab", "tasks_p"],
         ["click", "text:Add risk: test data"], ["grab", "risks_p"],
         ["click", "text:Note the extra review"], ["grab", "deliverables_p"],
         ["click", "text:Data migration scripts: 45"], ["grab", "timeline_p"]])
    run([["goto", "overview"], ["click", "text:Claude has proposed"], ["click", "aside [type=checkbox] >> nth=4"],
         ["click", 'aside button:text-is("SIGN OFF")'],
         ["goto", "tasks-issues"], ["grab", "tasks_s"], ["click", "text:Collect sign-off on data mapping"], ["grab", "tasks_s_t3"],
         ["goto", "risks"], ["grab", "risks_s"], ["click", "text:Test data not anonymised"], ["grab", "risks_s_r6"],
         ["goto", "deliverables"], ["grab", "deliverables_s"], ["click", "text:Data mapping specification"], ["grab", "deliverables_s_d2"],
         ["goto", "timeline"], ["grab", "timeline_s"]])
    run([["goto", "overview"], ["click", '[title="Toggle Assistant"]'], ["click", 'aside button:text-is("REVIEW")'],
         ["click", "aside >> text=Flag: Collect"], ["grab", "tasks_g"]], gemini=True)
    run([["goto", "overview"], ["click", '[title="Toggle Assistant"]'], ["click", 'aside button:text-is("APPROVE")'],
         ["goto", "tasks-issues"], ["grab", "tasks_f"], ["click", "text:Collect sign-off on data mapping"], ["grab", "tasks_f_t3"],
         ["goto", "overview"], ["click", "text:Claude has proposed"], ["click", "aside [type=checkbox] >> nth=4"],
         ["click", 'aside button:text-is("SIGN OFF")'],
         ["goto", "tasks-issues"], ["grab", "tasks_sf"], ["click", "text:Collect sign-off on data mapping"], ["grab", "tasks_sf_t3"]], gemini=True)

# ------------------------------------------------------------------ clean-up into templates
def icon_sub(m):
    svg = m.group(0)
    cm = re.search(r'class="([^"]*)"', svg)
    if not cm:
        return svg
    classes = cm.group(1).split()
    names = [c[7:] for c in classes if c.startswith("lucide-")]
    if "lucide" not in classes or not names:
        return svg
    name = names[0]
    if not os.path.exists(f"{ICONS}/{name}.svg"):
        name = re.sub(r"([a-z])(\d)", r"\1-\2", name, count=1)
    if not os.path.exists(f"{ICONS}/{name}.svg"):
        print("  (keeping an icon lucide-static does not name:", name, ")")
        return svg
    rest = " ".join(c for c in classes if c != "lucide" and not c.startswith("lucide-"))
    return f'<i data-icon="{name}" class="{rest}"></i>'

BREAKPOINTS = {"sm": 640, "md": 768, "lg": 1024, "xl": 1280, "2xl": 1536}
def to_container(m):
    return re.sub(r'(?<![\w\[-])(2xl|sm|md|lg|xl):', lambda b: f"@min-[{BREAKPOINTS[b.group(1)]}px]/app:", m.group(0))

def clean(html, tray=False):
    html = re.sub(r'class="[^"]*"', to_container, html)
    html = re.sub(r"<svg\b[^>]*>.*?</svg>", icon_sub, html, flags=re.S)
    html = re.sub(r'\s*style="(?:(?:opacity|translate|rotate|scale|transform|visibility|will-change)\s*:[^;"]*;?\s*)+"', "", html)
    html = re.sub(r"\s*content-visibility: auto;?", "", html)
    if tray:
        html = re.sub(r'class="fixed ', 'class="absolute ', html, count=1)
    return re.sub(r">\s+<", "><", html).strip()

def soup_of(html):
    return BeautifulSoup(f"<div id='__root'>{html}</div>", "lxml").find(id="__root")

def inner(node):
    return "".join(str(c) for c in node.contents)

OPENABLE = {"Collect sign-off on data mapping v2": "t3", "Test data not anonymised before UAT": "r6", "Data mapping specification": "d2"}
VIEWS = ["timeline_b", "timeline_p", "timeline_s", "deliverables_b", "deliverables_p", "deliverables_s",
         "tasks_b", "tasks_p", "tasks_s", "tasks_g", "tasks_f", "tasks_sf", "risks_b", "risks_p", "risks_s",
         "mom_b", "stakeholders_b", "documents_b", "codex_b", "billing_b"]
TRAYS = {"tray_t3_b": "tasks_b_t3", "tray_t3_f": "tasks_f_t3", "tray_t3_sf": "tasks_sf_t3", "tray_t3_p": "tasks_p",
         "tray_t3_s": "tasks_s_t3", "tray_t3_g": "tasks_g", "tray_r6_p": "risks_p", "tray_r6_s": "risks_s_r6",
         "tray_d2_b": "deliverables_b_d2", "tray_d2_p": "deliverables_p", "tray_d2_s": "deliverables_s_d2"}

def process():
    os.makedirs(OUT, exist_ok=True)
    for v in VIEWS:
        root = soup_of(open(f"{RAW}/{v}.main.html").read())
        for d in [d for d in root.find_all("div") if " ".join(d.get("class") or []).startswith("fixed top-0 right-0")]:
            d.decompose()
        for d in root.find_all(True):
            c = d.get("class") or []
            if any(x.startswith("lg:mr-[") for x in c):
                d["class"] = [x for x in c if not x.startswith("lg:mr-[")]
                d["data-shift"] = ""
            elif "overflow-y-auto" in c and "transition-all" in c and "flex-1" in c:
                d["data-shift"] = ""
        for h in root.find_all(["h3", "span", "div", "p"]):
            key = next((k for k in OPENABLE if h.string and h.string.strip().startswith(k)), None)
            if key:
                row = h.find_parent(lambda t: t.name == "div" and "cursor-pointer" in (t.get("class") or []))
                if row is not None and not row.has_attr("data-open"):
                    row["data-open"] = OPENABLE[key]
        for row in root.find_all(lambda t: t.name == "div" and {"cursor-pointer", "group"} <= set(t.get("class") or [])):
            if not row.has_attr("data-open"):
                row["data-row"] = ""
        open(f"{OUT}/{v}.html", "w").write(clean(inner(root)))
    for name, src in TRAYS.items():
        tray = soup_of(open(f"{RAW}/{src}.tray.html").read()).find("div")
        html = clean(str(tray), tray=True).replace(" translate-x-0", "", 1)
        open(f"{OUT}/{name}.html", "w").write(re.sub(r'class="absolute ', f'data-tray="{name}" class="absolute ', html, count=1))
    # The Overview, with hooks for what the demo redraws (demo.js paintOverview)
    root = soup_of(open(f"{RAW}/overview_b.main.html").read())
    for h3 in root.find_all("h3"):
        key = {"Schedule": "schedule", "Finish": "finish", "Late": "late", "Due in 7 days": "soon", "High risks": "high"}.get(h3.get_text(" ", strip=True))
        if not key:
            continue
        tile = h3.find_parent(lambda t: t.name == "div" and "p-5" in (t.get("class") or []))
        tile["data-kpi"] = key
        if key == "high":
            tile["data-h"] = "route:risks"
        if key == "schedule":
            tile.find("span", class_="text-4xl")["data-v"] = "actual"
            h3.parent.find_all("span", recursive=False)[-1]["data-v"] = "gap"
            tile.find(lambda t: t.name == "div" and {"bg-qb-box-bg", "h-2"} <= set(t.get("class") or [])).find("div")["data-v"] = "bar"
            tile.find("span", class_="rounded-full")["data-v"] = "dot"
        else:
            tile.find("p", class_="text-4xl")["data-v"] = "value"
    for h2 in root.find_all("h2"):
        label, box = h2.get_text(" ", strip=True), h2.parent.find_next_sibling()
        if label.startswith("Needs attention"):
            box["data-hook"] = "items"
            h2.find("span", class_="font-mono")["data-hook"] = "items-count"
        elif label == "Open risks":
            box["data-hook"] = "heat"
            h2.parent.find("button")["data-h"] = "route:risks"
        elif label.startswith("Progress by phase"):
            h2.parent.find("button")["data-h"] = "route:timeline"
        elif label.startswith("Deliverables"):
            h2.parent.find("button")["data-h"] = "route:deliverables"
    for d in root.find_all("div"):
        if "repeat(14" in (d.get("style") or ""):
            d["data-hook"] = "strip"
    row = root.find("span", string="3. Build").parent.parent
    row["data-phase"] = "build"
    row.find("span", class_="font-mono")["data-v"] = "pct"
    row.find(lambda t: t.name == "div" and {"h-1.5", "bg-qb-box-bg"} <= set(t.get("class") or [])).find("div")["data-v"] = "bar"
    open(f"{OUT}/overview.html", "w").write(clean(inner(root)))
    print("captures written to", os.path.normpath(OUT))

if __name__ == "__main__":
    capture()
    process()
