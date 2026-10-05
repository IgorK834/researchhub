#!/usr/bin/env python3
"""Real Docker security acceptance. Attack fixture source is executed exclusively in constrained containers.

Run from repository root: python3 sandbox/scripts/acceptance.py
Build researchhub-sandbox:1.1.0 first. This harness never evaluates fixture source on the host.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import selectors
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
IMAGE = 'researchhub-sandbox:1.1.0'
VERSION = '00000000-0000-4000-8000-000000000001'
LOG_LIMIT = 65_536


def docker(*args, check=True):
    return subprocess.run(['docker', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


def text_result(text='verified'):
    return "from pathlib import Path\nimport json\nPath('/outputs/result.json').write_text(json.dumps({'schemaVersion':'1.0','outputs':[{'name':'check','kind':'TEXT','text':" + repr(text) + "}]}))\n"


def sandbox(code, *, data=b'frequency (Hz),voltage (V),current (mA)\n200,2,4\n100,2,2\n',
            file_format='CSV', outputs=None, timeout=10, injected_env=False):
    name = 'rh-acceptance-' + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix='rh-sandbox-') as temporary:
        directory = Path(temporary)
        execution, inputs = directory / 'execution', directory / 'inputs'
        execution.mkdir(); inputs.mkdir()
        filename = VERSION + '.' + file_format.lower()
        (inputs / filename).write_bytes(data)
        manifest = {'schemaVersion': '1.0', 'inputs': [{'sourceVersionId': VERSION, 'format': file_format,
            'file': '/inputs/' + filename, 'sha256': hashlib.sha256(data).hexdigest()}],
            'outputs': outputs or [{'name': 'check', 'kind': 'TEXT'}]}
        (execution / 'manifest.json').write_text(json.dumps(manifest))
        (execution / 'code.py').write_text(code)
        for file in [*execution.iterdir(), *inputs.iterdir()]:
            file.chmod(0o444)
        execution.chmod(0o555); inputs.chmod(0o555)
        create = ['create', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                  '--security-opt', 'no-new-privileges:true', '--user', '65532:65532', '--workdir', '/execution',
                  '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64',
                  '--ulimit', 'nofile=128:128', '--log-driver', 'none',
                  '--mount', 'type=volume,dst=/outputs,volume-nocopy,volume-driver=local,volume-opt=type=tmpfs,volume-opt=device=tmpfs,"volume-opt=o=size=16777216,nr_inodes=128,noexec,nosuid,nodev,uid=65532,gid=65532,mode=0700"',
                  '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16777216,nr_inodes=128,mode=0700,uid=65532,gid=65532',
                  '--mount', f'type=bind,src={execution},dst=/execution,readonly',
                  '--mount', f'type=bind,src={inputs},dst=/inputs,readonly']
        if injected_env:
            create += ['--env', 'APP_TEST_SECRET=never-visible-to-generated-code']
        create += ['--entrypoint', 'python', IMAGE, '-I', '-c', 'import time;time.sleep(86400)']
        try:
            docker(*create)
            config = json.loads(docker('inspect', name).stdout)[0]
            assert config['Config']['User'] == '65532:65532'
            assert config['HostConfig']['NetworkMode'] == 'none'
            assert config['HostConfig']['ReadonlyRootfs'] is True
            assert config['HostConfig']['PidsLimit'] == 64
            assert config['HostConfig']['Memory'] == 268_435_456
            assert config['HostConfig']['CapDrop'] == ['ALL']
            docker('start', name)
            process = subprocess.Popen(['docker', 'exec', name, 'python', '-I', '/opt/researchhub/run.py'],
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            selector = selectors.DefaultSelector()
            selector.register(process.stdout, selectors.EVENT_READ)
            captured = bytearray(); failure = None; started = time.monotonic()
            while selector.get_map():
                if time.monotonic() - started > timeout:
                    failure = 'TIME_LIMIT'; break
                for key, _ in selector.select(0.1):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj); continue
                    captured.extend(chunk)
                    if len(captured) > LOG_LIMIT:
                        captured = captured[:LOG_LIMIT]; failure = 'LOG_LIMIT'; break
                if failure:
                    break
            selector.close()
            if failure:
                docker('kill', name, check=False)
                process.kill()
            process.wait(timeout=5)
            result = None
            if failure is None and process.returncode == 0:
                docker('pause', name)
                target = directory / 'result.json'
                docker('cp', name + ':/outputs/result.json', str(target))
                result = json.loads(target.read_text())
                for item in result['outputs']:
                    if item['kind'] == 'CHART':
                        image = directory / 'chart'
                        docker('cp', name + ':/outputs/' + item['file'], str(image))
                        assert image.stat().st_size > 1000
                        assert image.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
            return failure or ('SUCCESS' if process.returncode == 0 else 'CODE_FAILED'), result
        finally:
            docker('rm', '-f', '-v', name, check=False)
            assert docker('inspect', name, check=False).returncode != 0, 'container was not cleaned up'


def execute_tests():
    assert docker('image', 'inspect', IMAGE, check=False).returncode == 0, 'Build sandbox image first'
    isolation = '''import os, socket, subprocess
from pathlib import Path
assert os.getuid() == 65532 and Path.cwd() == Path('/execution')
assert not any('SECRET' in key or 'TOKEN' in key or 'PASSWORD' in key for key in os.environ)
assert not Path('/var/run/docker.sock').exists()
assert not Path('/app').exists()
for path in ['/execution/code.py', '/inputs/''' + VERSION + '''.csv', '/etc/forbidden']:
    try:
        Path(path).write_text('forbidden')
    except OSError:
        pass
    else:
        raise AssertionError('filesystem write escaped')
try:
    socket.create_connection(('1.1.1.1', 443), timeout=0.5)
except OSError:
    pass
else:
    raise AssertionError('network escaped')
assert subprocess.run(['python','-I','-m','pip','--version'], capture_output=True).returncode != 0
'''
    with tempfile.TemporaryDirectory(prefix='rh-unmounted-secret-') as secret_directory:
        host_secret = Path(secret_directory) / 'test-secret.txt'
        host_secret.write_text('researchhub-acceptance-secret')
        attempted_read = "\ntry:\n    Path(" + repr(str(host_secret)) + ").read_text()\nexcept OSError:\n    pass\nelse:\n    raise AssertionError('host secret was visible')\n"
        assert sandbox(isolation + attempted_read + text_result(), injected_env=True)[0] == 'SUCCESS'
    print('PASS nonroot, fixed cwd, unmounted host secret, secret stripping, no network/socket, readonly input/root, no installer, cleanup')

    specification = importlib.util.spec_from_file_location('fixture', ROOT / 'ai-worker/src/researchhub_worker/analysis/deterministic.py')
    fixture = importlib.util.module_from_spec(specification); specification.loader.exec_module(fixture)
    outputs = [{'name': 'impedance-table', 'kind': 'TABLE'}, {'name': 'impedance-chart', 'kind': 'CHART'}]
    code = fixture._code('/inputs/' + VERSION + '.csv', 'CSV', 'CSV', 1, [0, 1, 2], [1, 1, .001])
    status, value = sandbox(code, outputs=outputs)
    assert status == 'SUCCESS', status
    assert value['outputs'][0]['rows'] == [[100.0, 2.0, .002, 1000.0], [200.0, 2.0, .004, 500.0]]
    print('PASS actual CSV U/I calculation, mA conversion, sorted full table and PNG')

    # XLSX creation is trusted test data generation; generated/attacker code still runs only in Docker.
    from openpyxl import Workbook
    import io
    workbook = Workbook(); sheet = workbook.active; sheet.title = 'measurement_01'
    sheet.append(['f Hz', 'U V', 'I mA']); sheet.append([100, 2, 2]); sheet.append([200, 2, 4])
    buffer = io.BytesIO(); workbook.save(buffer); workbook.close()
    code = fixture._code('/inputs/' + VERSION + '.xlsx', 'XLSX', 'measurement_01', 1, [0, 1, 2], [1, 1, .001])
    status, value = sandbox(code, data=buffer.getvalue(), file_format='XLSX', outputs=outputs)
    assert status == 'SUCCESS' and value['outputs'][0]['rows'][0][-1] == 1000.0
    print('PASS actual XLSX U/I calculation and chart')

    cases = {
        'numeric-text': (fixture._code('/inputs/' + VERSION + '.csv', 'CSV', 'CSV', 1, [0,1,2], [1,1,.001]),
                         b'f,U,I\n100,n/a,2\n', outputs),
        'zero-current': (fixture._code('/inputs/' + VERSION + '.csv', 'CSV', 'CSV', 1, [0,1,2], [1,1,.001]),
                         b'f,U,I\n100,2,0\n', outputs),
        'nonfinite-json': ("from pathlib import Path\nPath('/outputs/result.json').write_text('{\"schemaVersion\":\"1.0\",\"outputs\":[{\"name\":\"check\",\"kind\":\"TABLE\",\"columns\":[\"x\"],\"rows\":[[NaN]]}]}')", None, [{'name':'check','kind':'TABLE'}]),
        'output-symlink': ("from pathlib import Path\nPath('/outputs/result.json').symlink_to('/execution/manifest.json')", None, None),
        'undeclared-file': ("from pathlib import Path\nPath('/outputs/undeclared').write_text('bad')\n" + text_result(), None, None),
        'output-disk-cap': ("from pathlib import Path\nPath('/outputs/huge').write_bytes(b'x'*20_000_000)\n" + text_result(), None, None),
        'memory-cap': ("blocks=[]\nwhile True: blocks.append(bytearray(16_000_000))", None, None),
        'pid-cap': ("import subprocess\nchildren=[]\nfor _ in range(100): children.append(subprocess.Popen(['python','-c','import time;time.sleep(30)']))", None, None),
        'malformed-json': ("from pathlib import Path\nPath('/outputs/result.json').write_text('{}')", None, None),
    }
    for name, (code, data, declared) in cases.items():
        kwargs = {'outputs': declared, 'timeout': 5}
        if data is not None: kwargs['data'] = data
        status, _ = sandbox(code, **kwargs)
        assert status != 'SUCCESS', name
        print('PASS ' + name + ' rejected; container cleaned')
    assert sandbox('while True: pass', timeout=1)[0] == 'TIME_LIMIT'
    print('PASS wall-clock timeout and cleanup')
    assert sandbox("import os\nwhile True: os.write(1, b'x'*4096)", timeout=3)[0] == 'LOG_LIMIT'
    print('PASS bounded stdout and cleanup')


if __name__ == '__main__':
    execute_tests()
