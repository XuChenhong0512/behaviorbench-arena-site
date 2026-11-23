"""部署前只读校验静态发布目录；不请求模型、不访问实验数据库或密钥。"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime
from hashlib import sha256
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit

FORBIDDEN_KEYS = {'api_key','authorization','response_headers','response_body_b64',
    'raw_response','generation_id','account_summary','opening_history','private_key','access_token'}
SECRET = re.compile(r'(?:sk-or-v1-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)')


def read_json(path):
    def bad(value):raise ValueError(f'Non-finite number: {path.name}')
    value=json.loads(path.read_text(encoding='utf-8'),parse_constant=bad)
    def walk(obj):
        if isinstance(obj,dict):
            if FORBIDDEN_KEYS & obj.keys():raise ValueError(f'Private envelope field in {path.name}')
            for value in obj.values():walk(value)
        elif isinstance(obj,list):
            for value in obj:walk(value)
    walk(value)
    return value


def local_path(root,relative):
    url=urlsplit(relative)
    if url.scheme or url.netloc or url.query or url.fragment or relative.startswith('/'):
        raise ValueError(f'Expected a local relative file: {relative}')
    path=(root/relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f'Missing or escaping asset: {relative}')
    return path


def frontend_path(root, relative):
    """Resolve a frontend asset with an optional release query."""
    url = urlsplit(relative)
    if url.query and not re.fullmatch(r"v=[0-9a-f]{1,40}", url.query):
        raise ValueError(f"Invalid asset version: {relative}")
    return local_path(root, url._replace(query="").geturl())


def verify_ultimatum_rerun(data, summary, indexed):
    """Require one specific supplement and its immutable original replay."""
    original = 'v7-ultimatum-r6-m0236'
    replacement = original + '-rerun1'
    paired = 'v7-ultimatum-r6-m0237'
    archive_path = f'v7/matches/{original}.json'
    games = [g for g in summary['games'] if 'ultimatum_rerun' in g or g['status'] == 'supplemental']
    replacements = [item for item in indexed if 'replaces_match_id' in item or item['id'] == replacement]
    if not games and not replacements:
        return False
    if (summary['id'] != 'v7' or len(games) != 1 or games[0]['id'] != 'ultimatum'
            or games[0]['status'] != 'supplemental' or len(replacements) != 1):
        raise ValueError('Only one explicit v7 Ultimatum replacement is supported.')
    game = games[0]
    provenance = game.get('ultimatum_rerun')
    expected = {'original_match_id': original, 'archived_match_path': archive_path, 'replacement_match_id': replacement,
                'paired_match_id': paired, 'original_valid_matches': 239, 'original_invalid_matches': 1,
                'original_ranked_matches': 238, 'original_ranking_blocks': 119}
    if not isinstance(provenance, dict) or any(provenance.get(k) != v for k, v in expected.items()):
        raise ValueError('Original endpoint and rerun references do not match the reviewed match.')
    try:
        if datetime.fromisoformat(provenance['completed_at']).utcoffset() is None:
            raise ValueError('Missing timezone')
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError('The rerun needs its completion timestamp.') from error
    item = replacements[0]
    if (item['id'] != replacement or item.get('replaces_match_id') != original
            or item['path'] != f'v7/matches/{replacement}.json' or item['game'] != 'ultimatum'
            or item['status'] != 'completed' or item['rounds'] != 6
            or any(x['id'] == original for x in indexed)):
        raise ValueError('The effective schedule must use the completed rerun once.')
    archive = local_path(data, archive_path)
    if sha256(archive.read_bytes()).hexdigest() != '336878e3b9dddfe940150fd420e5715e35596629f0cc2f41e051e6c77978da93':
        raise ValueError('The original failed replay archive changed.')
    archived = read_json(archive)
    sibling = next((x for x in indexed if x['id'] == paired), {})
    replay = read_json(local_path(data, item['path']))
    if (replay.get('replaces_match_id') != original or replay['source_match_id'] != archived['source_match_id'] + ':rerun-1'
            or item['players'] != archived['players'] or item.get('first_player_id') != 'P1'
            or sibling.get('players') != item['players'] or sibling.get('first_player_id') != 'P2'
            or sibling.get('game') != 'ultimatum' or sibling.get('status') != 'completed' or sibling.get('rounds') != 6):
        raise ValueError('The rerun does not match the archived participants and opposite-role pairing.')
    actual_requests = 0
    for rnd in replay['rounds']:
        proposer, responder = ('P1', 'P2') if rnd['number'] % 2 else ('P2', 'P1')
        public = rnd['public']
        offer, decision = public['offer'], public['decision']
        if (public['proposer_id'], public['responder_id']) != (proposer, responder) or (
                type(offer) is not int or not 0 <= offer <= 100 or decision not in ('Accept', 'Reject')):
            raise ValueError('The replay has an invalid Ultimatum action or role order.')
        payoffs = {proposer: 100 - offer, responder: offer} if decision == 'Accept' else {'P1': 0, 'P2': 0}
        actions = [(turn['player_id'], turn['role'], turn['action']) for turn in rnd['turns']]
        if rnd['payoffs'] != payoffs or actions != [(proposer, 'Proposer', offer), (responder, 'Responder', decision)]:
            raise ValueError('The replay actions and payoffs are inconsistent.')
        for turn in rnd['turns']:
            attempts = turn['attempts']
            actual_requests += len(attempts)
            accepted = [a for a in attempts if a['accepted']]
            if (len(accepted) != 1 or not isinstance(turn['raw_text'], str) or not turn['raw_text'].strip()
                    or accepted[0]['raw_text'] != turn['raw_text'] or accepted[0]['prompt'] != turn['prompt']):
                raise ValueError('A rerun action lost its accepted model response.')
    if (type(provenance.get('request_count')) is not int or provenance['request_count'] != actual_requests
            or not 12 <= actual_requests <= 72 or type(provenance.get('unknown_costs')) is not int
            or not 0 <= provenance['unknown_costs'] <= actual_requests):
        raise ValueError('Supplemental request counts do not match the replay.')
    counts = summary['counts']
    if (counts.get('planned_matches'), counts.get('valid_matches'), counts.get('invalid_matches'), counts.get('requests'),
            counts.get('accepted_decisions')) != (840, 840, 0, 11672 + actual_requests, 11525):
        raise ValueError('Effective match or total recorded request counts changed.')
    if (game['planned_matches'], game['ranking_matches'], game['ranking_blocks'], game['comparisons']) != (240, 240, 120, 240):
        raise ValueError('The rerun must close precisely the original two-match role block.')
    if any(row['ranking_matches'] != row['matches'] for row in game['rows']):
        raise ValueError('All effective Ultimatum appearances must enter the rerun ranking.')
    return True


def verify(directory):
    root=Path(directory).resolve();data=root/'data'
    for required in ('index.html','assets/app.js','assets/style.css','.nojekyll'):
        local_path(root,required)
    for reference in re.findall(r'''\b(?:src|href)\s*=\s*["'](\./assets/[^"']+)["']''', (root/'index.html').read_text(encoding='utf-8')):
        frontend_path(root, reference)
    for script in (root/'assets').glob('*.js'):
        for dependency in re.findall(r'''from\s+["'](\.[^"']+)["']''',script.read_text()):
            frontend_path(root,str((script.parent/dependency).relative_to(root)))
    total_bytes=0;hashes={}
    for file in sorted(root.rglob('*')):
        if file.is_symlink():raise ValueError('Publish real static files, not symlinks.')
        if not file.is_file():continue
        if file.suffix.lower() in {'.sqlite3','.sqlite','.db','.pem','.key','.env','.py'}:
            raise ValueError(f'Non-public runtime file: {file.name}')
        body=file.read_bytes();total_bytes+=len(body)
        if file.suffix=='.json':read_json(file)
        if len(body)>95_000_000:raise ValueError('A file exceeds the reviewed GitHub size ceiling.')
        if SECRET.search(body.decode('utf-8',errors='ignore')):raise ValueError(f'Credential-like string in {file.name}')
        hashes[str(file.relative_to(root))]=sha256(body).hexdigest()
    manifest=read_json(data/'manifest.json')
    if manifest['default_dataset']!='v7':raise ValueError('The six-model experiment must be the default.')
    ids=[row['id'] for row in manifest['datasets']]
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate dataset identifiers.')
    checked={};match_ids=set()
    for dataset in manifest['datasets']:
        summary=read_json(local_path(data,dataset['path']))
        model_ids={m['id'] for m in summary['models']}
        index=read_json(local_path(data,summary['matches_path']))
        indexed=index['matches'] if isinstance(index,dict) else index
        rerun=verify_ultimatum_rerun(data,summary,indexed)
        conditions=Counter();appearances=Counter()
        for item in indexed:
            if item['id'] in match_ids:raise ValueError('Duplicate saved match ID.')
            match_ids.add(item['id'])
            models=[p['model_id'] for p in item['players']]
            if len(set(models))!=len(models) or not set(models)<=model_ids:raise ValueError('Unregistered or duplicate participant.')
            conditions[item['game'],item['rounds'],item['status']]+=1
            if item['status']=='completed':
                for model in models:appearances[item['game'],item['rounds'],model]+=1
            detail=read_json(local_path(data,item['path']))
            if any(detail[k]!=item[k] for k in ('id','game','status','players','totals','winner_ids')):raise ValueError('Index/detail identity mismatch.')
            numbers=[r['number'] for r in detail['rounds']]
            if numbers!=list(range(1,len(numbers)+1)) or len(numbers)>item['rounds']:raise ValueError('Repeated, missing or excess round number.')
            seats={p['id']:p['model_id'] for p in item['players']}
            cumulative={p:0.0 for p in seats}
            settled=[r for r in detail['rounds'] if r['settled']]
            if len(settled)!=item['settled_rounds']:raise ValueError('Settled round count mismatch.')
            if item['status']=='completed' and len(settled)!=item['rounds']:raise ValueError('A completed match is missing rounds.')
            if item['status']!='completed' and (detail.get('totals') is not None or detail.get('winner_ids')):
                raise ValueError('An invalid match has a fabricated winner or final return.')
            for rnd in detail['rounds']:
                if rnd['settled']:
                    if set(rnd['payoffs'])!=set(seats):raise ValueError('Missing player return.')
                    for player,amount in rnd['payoffs'].items():cumulative[player]+=float(amount)
                    if set(rnd['cumulative_returns'])!=set(seats) or any(not math.isclose(cumulative[p],float(rnd['cumulative_returns'][p]),abs_tol=1e-8) for p in seats):raise ValueError('Cumulative return mismatch.')
                if not rnd['settled'] and rnd.get('payoffs') is not None:
                    raise ValueError('An unsettled round has fabricated payoffs.')
                for turn in rnd['turns']:
                    if seats.get(turn['player_id'])!=turn['model_id']:raise ValueError('Foreign or swapped player/model in replay.')
                    for msg in turn.get('prompt') or []:
                        if set(msg)!={'role','content'} or not isinstance(msg['content'],str):raise ValueError('Malformed saved prompt.')
            if item['status']=='completed' and any(not math.isclose(cumulative[p],float(detail['totals'][p]),abs_tol=1e-8) for p in seats):raise ValueError('Final total differs from settled rounds.')
        for game in summary['games']:
            if game['valid_matches']!=conditions[game['id'],game['rounds'],'completed']:
                raise ValueError('Summary valid-match count differs from replay index.')
            if game['invalid_matches']!=conditions[game['id'],game['rounds'],'invalid']:
                raise ValueError('Summary invalid count differs from replay index.')
            if {r['model_id'] for r in game['rows']}!=model_ids:raise ValueError('Ranking/model pool mismatch.')
            for row in game['rows']:
                if row['matches']!=appearances[game['id'],game['rounds'],row['model_id']]:raise ValueError('Valid appearances differ from saved participants.')
                if row['ranking_matches']>row['matches']:raise ValueError('Eligible appearances exceed valid appearances.')
                if row.get('ci_low') is not None and not row['ci_low']<=row['bt']<=row['ci_high']:
                    raise ValueError('Invalid saved score interval.')
                if game['status'] in ('provisional','supplemental') and any(row.get(k) is not None for k in ('ci_low','ci_high','rank_low','rank_high')):
                    raise ValueError('Provisional or supplemental scores must not acquire intervals.')
        checked[dataset['id']]={'matches':len(indexed),'models':len(model_ids),'conditions':len(summary['games'])}
        if dataset['id']=='v7':
            if len(model_ids)!=6 or len(indexed)!=840:raise ValueError('The formal scope changed.')
            required={'beauty_contest':(120,0),'ultimatum':(240,0) if rerun else (239,1),'trust':(240,0),'public_goods':(120,0),'push_pull':(120,0)}
            if {(g['id'],g['rounds']) for g in summary['games']}!={(g,6) for g in required} or len(summary['games'])!=5:raise ValueError('Formal game set changed.')
            for game in summary['games']:
                if (game['valid_matches'],game['invalid_matches'])!=required[game['id']]:raise ValueError('Formal game totals changed.')
            for game in summary['games']:
                if game['rounds']!=6:raise ValueError('Formal horizon changed.')
                expected={'beauty_contest':120,'ultimatum':240 if rerun else 238,'trust':240,'public_goods':120,'push_pull':120}[game['id']]
                if game['ranking_matches']!=expected:raise ValueError('Formal eligible match count changed.')
                if game['id']=='ultimatum' and not rerun and game['status']!='provisional':
                    raise ValueError('The incomplete role-balanced block was hidden.')
    return {'ok':True,'datasets':checked,'files':len(hashes),'bytes':total_bytes,'sha256':hashes,'new_model_requests':0}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory',type=Path,nargs='?',default=Path('pages'))
    p.add_argument('--output',type=Path);args=p.parse_args()
    result=verify(args.directory)
    if args.output:args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='sha256'},indent=2))


if __name__=='__main__':main()
