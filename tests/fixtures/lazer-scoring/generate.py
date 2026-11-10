#!/usr/bin/env python3
"""Run pinned, unmodified lazer C# arithmetic with small framework/beatmap adapters.

Usage: python3 generate.py --dotnet /path/to/dotnet [--source-root /tmp/lazer-score-audit]
Only ScoreProcessor's event-bookkeeping prefix and arithmetic methods are extracted;
UI callbacks are excluded. Mania, health calibration, pp and strain classes are compiled verbatim.
"""
import argparse, gzip, hashlib, json, os, pathlib, random, subprocess, tempfile

PIN = 'd551a04bc4fa613bc25cf04d6e7becbd5cca64cf'
ROOT = pathlib.Path(__file__).resolve().parent
FILES = [
    'osu.Game/Rulesets/Scoring/HitResult.cs',
    'osu.Game/Rulesets/Scoring/HealthProcessor.cs',
    'osu.Game/Rulesets/Scoring/LegacyDrainingHealthProcessor.cs',
    'osu.Game/Rulesets/Scoring/ScoreProcessor.cs',
    'osu.Game/Rulesets/Scoring/ScoreMultiplierCalculator.cs',
    'osu.Game.Rulesets.Mania/Scoring/ManiaHealthProcessor.cs',
    'osu.Game.Rulesets.Mania/Scoring/ManiaScoreProcessor.cs',
    'osu.Game.Rulesets.Mania/Scoring/ManiaScoreMultiplierCalculator.cs',
    'osu.Game.Rulesets.Mania/Difficulty/ManiaPerformanceCalculator.cs',
    'osu.Game.Rulesets.Mania/Difficulty/Skills/Strain.cs',
    'osu.Game.Rulesets.Mania/Difficulty/Preprocessing/ManiaDifficultyHitObject.cs',
    'osu.Game.Rulesets.Mania/Difficulty/Evaluators/IndividualStrainEvaluator.cs',
    'osu.Game.Rulesets.Mania/Difficulty/Evaluators/OverallStrainEvaluator.cs',
    'osu.Game/Rulesets/Difficulty/Skills/StrainSkill.cs',
    'osu.Game/Rulesets/Difficulty/Skills/StrainDecaySkill.cs',
    'osu.Game/Rulesets/Difficulty/Skills/Skill.cs',
    'osu.Game/Rulesets/Difficulty/Preprocessing/DifficultyHitObject.cs',
    'osu.Game.Rulesets.Mania/MathUtils/LegacySortHelper.cs',
    'osu.Game.Rulesets.Mania/Mods/ManiaModPerfect.cs',
]

def method(text, signature):
    at = text.index(signature)
    start = text.index('{', at)
    depth = 1
    end = start + 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[at:end]

def inputs():
    rng = random.Random(7112026)
    notes = lambda n, gap=200: [dict(time=i*gap, end=i*gap+(gap*2 if i%5==0 else 0), isLN=i%5==0, col=i%4) for i in range(n)]
    health = []
    for hp in [0, .1, 1, 4.7, 5, 7.3, 9.9, 10]:
        for mods in [[], ['EZ'], ['HR'], ['NF'], ['DA']]:
            ns = notes(75)
            health.append(dict(id=f'hp{hp}/{"-".join(mods) or "NM"}', hp=hp, hpOverride=7.25 if 'DA' in mods else None, mods=mods, notes=ns, breaks=[dict(start=3000,end=5000)], events=[dict(j=i%6, hold=i%3==0, t=i*200) for i in range(75)]))
    health += [dict(id='sparse-long-holds', hp=5, mods=[], notes=notes(10,30000), breaks=[], events=[dict(j=5,hold=False,t=i*1000) for i in range(60)])]
    for m in [[],['EZ'],['NF'],['SD'],['PF'],['PSS']]:
        health.append(dict(id=f'fail/{m}',hp=5,mods=m,notes=notes(100),breaks=[],events=[dict(j=5,hold=False,t=i*200) for i in range(100)]))
        health.append(dict(id=f'body/{m}',hp=5,mods=m,notes=notes(5),breaks=[],events=[dict(j=j,hold=False,t=i*200) for i,j in enumerate([0,1,2,-1,5,0])]))
    score = []
    for n in [1, 2, 3, 7, 40, 401, 1600]:
        for mods in [[], ['EZ'], ['NF'], ['EZ','NF'], ['HT'], ['NR'], ['DA'], ['4K'], ['RT']]:
            for variant in ['perfect','great','mixed']:
                js = [0 if variant=='perfect' else 1 if variant=='great' else rng.randrange(6) for _ in range(n)]
                if variant=='mixed' and n>7: js[n//2] = -1 # hold-body combo break, excluded from accuracy.
                score.append(dict(id=f'{n}/{"-".join(mods) or "NM"}/{variant}', total=n-(1 if -1 in js else 0), mods=mods, config=dict(rate=.85), sequence=js))
    pp = [dict(id=f'{stars}/{n}/{m}', stars=stars, counts=[int(n*.8),int(n*.1),int(n*.04),int(n*.03),int(n*.02),n-int(n*.8)-int(n*.1)-int(n*.04)-int(n*.03)-int(n*.02)], mods=m) for stars in [0,.5,2,5.321,12] for n in [0,1,100,1500,3000] for m in [[],['NF'],['EZ'],['NF','EZ']]]
    pp += [dict(id=f'statistics-guard/{i}',stars=5,counts=c,mods=[]) for i,c in enumerate([[10,0,0,0,0,-1],[10,-8,0,0,0,0],[10,0]])]
    difficulty = [dict(id=f'{n}/{rate}', keys=4, rate=rate, notes=notes(n,137.25)) for n in [0,1,2,20,500] for rate in [.5,.75,1,1.1,1.5,2]]
    for keys in [4,7,9]:
        chord=[dict(time=t*125,end=t*125+(500 if col%3==0 else 0),isLN=col%3==0,col=col) for t in range(30) for col in range(keys)]
        fractional=[dict(time=i*137.5,end=i*137.5+(100 if i%4==0 else 0),isLN=i%4==0,col=i%keys) for i in range(40)]
        for rate in [.75,1,1.1,1.5]:
            difficulty += [dict(id=f'chords/{keys}/{rate}',keys=keys,rate=rate,notes=chord),dict(id=f'fractional/{keys}/{rate}',keys=keys,rate=rate,notes=fractional)]
    file_order=[dict(time=t*800,end=t*800+[100,600,300,0][i],isLN=i!=3,col=col) for t in range(12) for i,col in enumerate([3,0,2,1])]
    difficulty.append(dict(id='file-order/chords',keys=4,rate=1,notes=file_order))
    health.append(dict(id='file-order/chords',hp=7.3,mods=[],notes=file_order,breaks=[],events=[dict(j=i%6,hold=i%3==0,t=i*200) for i in range(60)]))
    return dict(health=health, score=score, pp=pp, difficulty=difficulty)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--dotnet',default='dotnet'); ap.add_argument('--source-root',type=pathlib.Path); args=ap.parse_args()
    with tempfile.TemporaryDirectory(prefix='lazer-scoring-') as tmp:
        work=pathlib.Path(tmp); hashes={}; sources={}
        for name in FILES:
            if args.source_root:
                raw=(args.source_root/name).read_bytes()
            else:
                raw=subprocess.check_output(['curl','-fsSL',f'https://raw.githubusercontent.com/ppy/osu/{PIN}/{name}'])
            sources[name]=raw.decode('utf-8-sig').replace('\r\n','\n').rstrip()+'\n'
            hashes[name]=hashlib.sha256(sources[name].encode()).hexdigest()
            if name.endswith('/ScoreProcessor.cs'): continue
            (work/(name.replace('/','_'))).write_text(sources[name])
        score=sources['osu.Game/Rulesets/Scoring/ScoreProcessor.cs']
        apply=method(score,'protected sealed override void ApplyResultInternal')
        prefix=apply[apply.index('{')+1:apply.index('            if (!IsSimulating)')]
        generated=(ROOT/'Adapters.cs').read_text().replace('/* APPLY_RESULT */',prefix).replace('/* UPDATE_SCORE */',method(score,'private void updateScore()')).replace('/* BASE_SCORE */',method(score,'public virtual int GetBaseScoreForResult'))
        (work/'Adapters.cs').write_text(generated)
        (work/'Program.cs').write_text((ROOT/'Program.cs').read_text())
        (work/'Reference.csproj').write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><WarningLevel>0</WarningLevel></PropertyGroup></Project>')
        env={**os.environ, 'DOTNET_CLI_HOME':str(work/'.cli'), 'NUGET_PACKAGES':str(work/'.nuget'), 'DOTNET_CLI_TELEMETRY_OPTOUT':'1', 'DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1'}
        subprocess.run([args.dotnet,'build',str(work/'Reference.csproj'),'-o',str(work/'bin'),'--nologo','-v:q'],check=True,env=env)
        cases=inputs(); result=subprocess.check_output([args.dotnet,str(work/'bin/Reference.dll')],input=json.dumps(cases).encode(),env=env)
        out=dict(source=PIN, sourceHashes=hashes, inputs=cases, expected=json.loads(result))
        (ROOT/'reference.json.gz').write_bytes(gzip.compress((json.dumps(out,separators=(',',':'))+'\n').encode(),mtime=0))
        print({k:len(v) for k,v in cases.items()})

if __name__=='__main__': main()
