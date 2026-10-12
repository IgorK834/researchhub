#!/usr/bin/env python3
"""CAI-18: one entrypoint for real browser/product/runtime validation and a fixed benchmark.

Prerequisites: Java 25, Node, uv/Python 3.13.3, Docker with a local Unix socket and Chromium.
--live adds bounded Gemini calls using worker-only credentials and can incur cost.
"""
import argparse
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

import stack
ROOT=Path(__file__).resolve().parents[2]
# Each matrix requirement needs successful real JUnit evidence; skipped tests never qualify.
CASES={
 '01':['CanvasApiIntegrationTest.realBrowserAndCanonicalYjs'],
 '02':['CanvasApiIntegrationTest.realBrowserAndCanonicalYjs'],
 '03':['CanvasApiIntegrationTest.realBrowserAndCanonicalYjs'],
 '04':['CanvasApiIntegrationTest.realBrowserAndCanonicalYjs'],
 '05':['CanvasApiIntegrationTest.durableCaptureReplayScopeCsrfAndRevocation'],
 '06':['CanvasApiIntegrationTest.foreignDocumentSourceAndOutputAreDeniedAndArchivedHistoryIsReadable'],
 '07':['CanvasProposalApiIntegrationTest.browserProposalReviewAndBothStorageModes'],
 '08':['CanvasProposalApiIntegrationTest.browserProposalReviewAndBothStorageModes','CanvasProposalApiIntegrationTest.expansionSupersedesOnlyPendingVersionAndPreservesImmutableHistory'],
 '09':['CanvasProposalApiIntegrationTest.browserProposalReviewAndBothStorageModes','CanvasProposalApiIntegrationTest.acceptedReferenceUsesCurrentGeneratedBlocksAndCompensatedReferencesFailSafely'],
 '10':['CanvasDocumentTargetTest.sourceAndAnalysisReferencesComeOnlyFromSavedAtoms','CanvasEditTest.crossParagraphReplaceClipsCommentsAndAddsOnlyResolvedCitations'],
 '11':['CanvasProposalApiIntegrationTest.browserProposalReviewAndBothStorageModes'],
 '12':['CanvasProposalApiIntegrationTest.canonicalEpochChangeRejectsPendingApproval','CanvasProposalApiIntegrationTest.targetConflictsPreservePendingProposalAndUnrelatedEditsSurvive'],
 '13':['CanvasProposalApiIntegrationTest.canonicalCommitChecksFrozenProjectionEncodingSequenceAndReplaysDurableReceipt','CollaborationApiIntegrationTest.twoWebsocketClientsUseRealSpringAuthorizationAndRecoverAfterServiceRestart'],
 '14':['CanvasProposalApiIntegrationTest.canonicalRoleRevocationBeforeCommitRollsBackSnapshotAndProvenance'],
 '15':['SourceExtractionEndToEndTest.promptInjectionUploadCannotReadOtherWorkspaceOrChangeGroundingAndAuthorization'],
 '16':['ProblemApiIntegrationTest.electricalAndEliminationFixturesHaveIndependentExpectedValues'],
 '17':['ProblemApiIntegrationTest.electricalAndEliminationFixturesHaveIndependentExpectedValues'],
 '18':['ProblemApiIntegrationTest.electricalAndEliminationFixturesHaveIndependentExpectedValues'],
 '19':['ProblemApiIntegrationTest.missingIncompatibleAndZeroInputsPublishNoVerifiedResult'],
 '20':['ProblemApiIntegrationTest.electricalAndEliminationFixturesHaveIndependentExpectedValues'],
 '21':['SourceExtractionEndToEndTest.xlsxComputationUsesEveryRowBeyondTheInspectionAndConvertsExplicitMilliampereUnits'],
 '22':['CanvasProposalApiIntegrationTest.browserProposalReviewAndBothStorageModes','ProblemApiIntegrationTest.savedSolutionEvidenceAndCompletePackageAreHistoricalScopedAndAtomic'],
 '23':['CanvasProposalApiIntegrationTest.failuresPublishNoProposalAndKeepTheSavedPrompt','CanvasProposalApiIntegrationTest.cancelDuringPaidModelCallFencesLateProposalAndRestart','CanvasProposalApiIntegrationTest.uncertainPaidLeaseIsNotRetriedAndFailureKeepsPrompt','DockerSandboxRunnerIntegrationTest.loopTimeoutAndMemoryLimitDoNotPoisonTheNextRun'],
 '24':['CanvasProposalApiIntegrationTest.undoDoesNotEraseSubsequentHumanEdits','ProblemApiIntegrationTest.savedSolutionEvidenceAndCompletePackageAreHistoricalScopedAndAtomic']}

def evidence(directory):
    tests={};totals=dict(tests=0,failures=0,errors=0,skipped=0)
    for path in sorted(directory.glob('TEST-*.xml')):
        root=ET.parse(path).getroot()
        for k in totals:totals[k]+=int(root.get(k,0))
        for test in root.findall('testcase'):
            name=test.get('classname','').rsplit('.',1)[-1]+'.'+test.get('name','').split('(')[0]
            passed=not any(test.find(k) is not None for k in ['failure','error','skipped'])
            tests[name]=tests.get(name,True) and passed
    matrix={id:all(tests.get(name,False) for name in names) for id,names in CASES.items()}
    return {'totals':totals,'matrix':matrix,'requiredSkippedOrMissing':sum(not v for v in matrix.values()),'references':CASES}

def stage(name,command,cwd,output,environment):
    start=time.monotonic();path=output/(name+'.log')
    with path.open('w') as log:
        path.chmod(0o600)
        result=subprocess.run(command,cwd=cwd,env=environment,stdout=log,stderr=subprocess.STDOUT,check=False)
    value={'stage':name,'exitCode':result.returncode,'durationMs':round((time.monotonic()-start)*1000),'log':str(path)}
    print(json.dumps(value),flush=True)
    return value

def commands():
    python=str(ROOT/'ai-worker/.venv/bin/python')
    return [
        ('security',['python3','scripts/security/check_analysis_boundary.py'],ROOT),
        ('frontend-lint',['npm','run','lint'],ROOT/'frontend'),
        ('frontend-tests',['npm','run','test:coverage','--','--runInBand'],ROOT/'frontend'),
        ('frontend-realtime',['npm','run','build:realtime'],ROOT/'frontend'),
        ('frontend-legacy',['npm','run','build','--','--output-path','dist-canvas-legacy'],ROOT/'frontend'),
        ('collaboration-build',['npm','run','build'],ROOT/'collaboration'),
        ('collaboration-tests',['npm','test'],ROOT/'collaboration'),
        ('sandbox-build',['docker','build','-t','researchhub-sandbox:1.2.0','sandbox'],ROOT),
        ('worker-tests',['./scripts/check.sh'],ROOT/'ai-worker'),
        ('sandbox-tests',[str(ROOT/'sandbox/.venv/bin/python'),'-m','pytest'],ROOT/'sandbox'),
        ('demo-tests',[python,'-m','unittest','discover','-s','scripts/demo','-p','test_*.py'],ROOT),
        ('backend',['./mvnw','--batch-mode','--no-transfer-progress','verify'],ROOT/'backend'),
        ('offline',[python,'-m','researchhub_worker.evaluation.canvas','--mode','offline'],ROOT/'ai-worker')]

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--live',action='store_true');parser.add_argument('--output',type=Path,default=ROOT/'.demo/canvas-suite');args=parser.parse_args(argv)
    output=args.output.resolve();output.mkdir(parents=True,exist_ok=True);output.chmod(0o700)
    env=stack.without_worker_settings(os.environ);env.update(ANALYSIS_SANDBOX_TESTS='true',CANVAS_BROWSER_TESTS='true',COLLABORATION_BROWSER_TESTS='true',EXPORT_BROWSER_TESTS='true')
    stages=[]
    for name,command,cwd in commands():
        if name=='offline':command+=['--output',str(output/'offline.json')]
        effective={**env,'RESEARCHHUB_COLLABORATION_ENABLED':'false'} if name=='frontend-legacy' else env
        result=stage(name,command,cwd,output,effective);stages.append(result)
        if result['exitCode']!=0:break
    proof=evidence(ROOT/'backend/target/surefire-reports') if stages[-1]['stage']=='offline' and stages[-1]['exitCode']==0 else None
    if args.live and proof and proof['requiredSkippedOrMissing']==0:
        print('Explicit live Gemini benchmark: worker-only key, maximum 3 provider attempts per case; paid calls may incur cost.',flush=True)
        command=[str(ROOT/'ai-worker/.venv/bin/python'),'-m','researchhub_worker.evaluation.canvas','--mode','live','--output',str(output/'live.json')]
        stages.append(stage('live',command,ROOT/'ai-worker',output,{**env,**stack.worker_env()}))
    report={'schemaVersion':'1.0','timestamp':datetime.now(timezone.utc).isoformat(),'stages':stages,'junit':proof,'liveRequested':args.live,'passed':all(v['exitCode']==0 for v in stages) and proof is not None and proof['requiredSkippedOrMissing']==0}
    stack.save_private(output/'suite.json',report)
    print(json.dumps({'passed':report['passed'],'requiredSkippedOrMissing':proof['requiredSkippedOrMissing'] if proof else None,'report':str(output/'suite.json')}))
    return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
