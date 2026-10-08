#!/usr/bin/env python3
"""Idempotently seed the project-authored RC lab through public REST endpoints only."""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import uuid
from api import Client, ApiError, save_private, wait_for
from generate_fixtures import DESTINATION, FILES

NAME = "RC Circuit Lab (Synthetic)"
TITLE = "RC Circuit Laboratory Report"
PROMPT = "Estimate tau for this RC discharge and plot measured versus fitted voltage using all immutable measurements."
QUESTION = "What time constant should we expect from the component values?"
HUMIDITY = "What was the room humidity during the experiment?"
NAMESPACE = uuid.UUID("ad3c3fa4-9505-4b04-a681-3e070c54691a")


def stable_id(name):
    return str(uuid.uuid5(NAMESPACE, name))


def accounts(count):
    return [("owner", "RC Private Owner"), ("demo-editor", "RC Demo Editor"),
            ("collaboration-editor", "RC Collaboration Editor")] + [
                (f"load-{index:03d}", f"Synthetic Load User {index:03d}") for index in range(1, count + 1)]


def document_content(analysis, execution):
    paragraphs = {
        "Objective": "Estimate the RC discharge time constant from reproducible synthetic measurements.",
        "Theory": "Nominal R = 10,000 ohms and C = 470 microfarads imply tau = 4.7 seconds. See the authored theory notes.",
        "Method": "Three simulated trials, 0.25-second sampling and fixed random seed 316. No real participant or private data.",
        "Measurements": "The immutable workbook contains time_s, voltage_v, trial and temperature_c.",
        "Analysis": "Fit log voltage versus time from the full immutable workbook in the real isolated Python sandbox.",
        "Discussion": "Compare the fitted tau with nominal component tolerances. Additive noise can bias a log-linear fit.",
        "Conclusion": "The synthetic lab demonstrates source-grounded reasoning and reproducible execution; it is not a physical measurement.",
    }
    content = []
    for heading, text in paragraphs.items():
        content.append({"type": "heading", "attrs": {"level": 2, "blockId": stable_id(heading)}, "content": [{"type": "text", "text": heading}]})
        node = {"type": "text", "text": text}
        if heading == "Discussion":
            node["marks"] = [{"type": "commentAnchor", "attrs": {"ids": [stable_id("review-anchor")]}}]
        content.append({"type": "paragraph", "attrs": {"blockId": stable_id(heading + "-paragraph")}, "content": [node]})
        if heading == "Analysis":
            for output, mode in (("rc-fit-summary", "SUMMARY"), ("rc-fit-table", "TABLE"), ("rc-discharge-chart", "CHART")):
                content.append({"type": "analysisResult", "attrs": {"blockId": stable_id(output),
                    "reference": {"analysisId": analysis, "executionId": execution, "outputId": output, "renderMode": mode},
                    "caption": "Synthetic RC discharge; full execution provenance is retained."}})
    return {"type": "doc", "content": content}


def seed(base_url, state_path, load_users=200, client_factory=Client):
    state_path = Path(state_path)
    state = json.loads(state_path.read_text()) if state_path.exists() else {"accounts": {}}
    anonymous = client_factory(base_url)
    anonymous.request("GET", "/api/auth/csrf", expected=(204,))
    for slug, name in accounts(load_users):
        if slug not in state["accounts"]:
            state["accounts"][slug] = {"email": slug + "@rc-demo.example.test", "password": secrets.token_urlsafe(24), "displayName": name}
            save_private(state_path, state)
        account = state["accounts"][slug]
        if not account.get("registered"):
            try:
                anonymous.post("/api/auth/register", {key: account[key] for key in ("email", "password", "displayName")}, expected=(201,))
            except ApiError as error:
                if error.status != 409:
                    raise
                # A crash after registration is recoverable only with the stored generated password.
                client_factory(base_url).login(account)
            account["registered"] = True
            save_private(state_path, state)
            if not slug.startswith("load-"):
                print(f"Generated account (shown once): {account['email']}  password={account['password']}", flush=True)
    owner = client_factory(base_url)
    owner.login(state["accounts"]["owner"])
    workspaces = [workspace for workspace in owner.get("/api/workspaces") if workspace["name"] == NAME]
    if len(workspaces) > 1:
        raise RuntimeError("Ambiguous synthetic workspace: refuse to select or duplicate it")
    workspace = workspaces[0] if workspaces else owner.post("/api/workspaces", {"name": NAME, "description": "Project-authored synthetic RC lab; fixed seed 316; no private data."})
    workspace_id = workspace["id"]
    route = "/api/workspaces/" + workspace_id
    if owner.get(route + "/ai/model")["provider"] != "deterministic":
        raise RuntimeError("Demo and load data must use the deterministic model provider")
    members = {member["email"] for member in owner.get(route + "/members")}
    for slug, _ in accounts(load_users):
        if slug != "owner" and state["accounts"][slug]["email"] not in members:
            owner.post(route + "/members", {"email": state["accounts"][slug]["email"], "role": "EDITOR" if "editor" in slug else "VIEWER"})
    sources = {source["originalFilename"]: source for source in owner.get(route + "/sources")}
    hashes = {}
    for filename in FILES:
        file = DESTINATION / filename
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        hashes[filename] = digest
        if filename not in sources:
            sources[filename] = owner.upload(route + "/sources", file)
        if sources[filename]["contentSha256"] != digest:
            raise RuntimeError("Existing synthetic source hash differs: " + filename)
        source = wait_for(lambda: owner.get(route + "/sources/" + sources[filename]["id"]),
                          lambda value: value["status"] in ("READY", "FAILED"))
        if source["status"] != "READY":
            raise RuntimeError("Source processing failed: " + filename)
        sources[filename] = source
    analysis_list = [item for item in owner.get(route + "/analyses") if item["userPrompt"] == PROMPT]
    dataset = sources["rc-measurements.xlsx"]
    analysis = analysis_list[0] if analysis_list else owner.post(route + "/analyses", {
        "userPrompt": PROMPT, "inputs": [{"sourceId": dataset["id"], "sourceVersionId": dataset["activeVersionId"],
                                         "sheetName": "Measurements", "columns": [1, 2]}]})
    analysis_route = route + "/analyses/" + analysis["id"]
    if analysis["plan"] is None:
        analysis = owner.post(analysis_route + "/plan")
    if analysis["plan"] is None or "rc-fit-table" not in [output["name"] for output in analysis["plan"]["outputs"]]:
        raise RuntimeError("The real RC computation plan must be available")
    executions = owner.get(analysis_route + "/executions")
    successful = [execution for execution in executions if execution["status"] == "SUCCEEDED"]
    if successful:
        execution = successful[0]
    else:
        execution = owner.post(analysis_route + "/execute")
        execution = wait_for(lambda: owner.get(analysis_route + "/executions/" + execution["id"]),
                             lambda value: value["status"] in ("SUCCEEDED", "FAILED"))
    if execution["status"] != "SUCCEEDED":
        raise RuntimeError("Real sandbox execution required; failure=" + str(execution.get("failureCode")))
    provenance = execution["provenance"]
    if not provenance["imageId"] or not provenance["codeSha256"] or provenance["inputs"][0]["sha256"] != hashes["rc-measurements.xlsx"]:
        raise RuntimeError("Execution provenance does not bind the real runtime and immutable dataset")
    content = document_content(analysis["id"], execution["id"])
    documents = [document for document in owner.get(route + "/documents") if document["title"] == TITLE]
    document = documents[0] if documents else owner.post(route + "/documents", {"title": TITLE, "content": content})
    document_route = route + "/documents/" + document["id"]
    if owner.get(document_route)["content"] != content:
        raise RuntimeError("Existing seeded report differs; preserve edits instead of overwriting them")
    editor = client_factory(base_url)
    editor.login(state["accounts"]["demo-editor"])
    comment_id = stable_id("component-review")
    comments = editor.get(document_route + "/comments")
    if not any(comment["id"] == comment_id for comment in comments):
        editor.post(document_route + "/comments", {"id": comment_id, "body": "Please compare fitted tau with the component tolerance range.",
            "anchor": {"strategy": "TEXT_MARK_V1", "id": stable_id("review-anchor"), "quote": "Compare the fitted tau with nominal component tolerances."}})
    collaborator = client_factory(base_url)
    collaborator.login(state["accounts"]["collaboration-editor"])
    comment = collaborator.get(document_route + "/comments/" + comment_id)["comment"]
    reply_id = stable_id("component-review-reply")
    if not any(reply["id"] == reply_id for reply in comment["replies"]):
        collaborator.post(document_route + "/comments/" + comment_id + "/replies", {"id": reply_id, "body": "The immutable notes give a 4.42035 to 4.98435 second nominal tolerance range."})
    answers = {name: owner.post(route + "/ai/questions", {"question": question}) for name, question in (("grounded", QUESTION), ("humidity", HUMIDITY))}
    if answers["grounded"]["status"] != "SUPPORTED" or not answers["grounded"]["citations"] or "4.7" not in answers["grounded"]["answer"]:
        raise RuntimeError("Expected component time constant must be supported by a citation")
    if answers["humidity"]["status"] != "INSUFFICIENT_EVIDENCE" or answers["humidity"]["citations"]:
        raise RuntimeError("Unrecorded humidity must return explicit insufficient evidence")
    result = {"workspaceId": workspace_id, "documentId": document["id"], "analysisId": analysis["id"], "executionId": execution["id"],
              "fixtureHashes": hashes, "answers": {key: {"status": value["status"], "citationCount": len(value["citations"])} for key, value in answers.items()},
              "executionProvenance": provenance}
    save_private(state_path.parent / "seed-manifest.json", result)
    load_accounts = [{key: state["accounts"][slug][key] for key in ("email", "password")} for slug, _ in accounts(load_users) if slug.startswith("load-")]
    save_private(state_path.parent / "k6.json", {**result, "users": load_accounts})
    print(f"Seed ready: workspace={workspace_id}, sources={len(FILES)}, real execution={execution['id']}, synthetic load users={load_users}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:18083")
    parser.add_argument("--state", type=Path, default=Path(".demo/accounts.json"))
    parser.add_argument("--load-users", type=int, choices=range(0, 201), default=200)
    args = parser.parse_args()
    seed(args.base_url, args.state, args.load_users)


if __name__ == "__main__":
    main()
