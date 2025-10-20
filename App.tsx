import React, { useState, useCallback, useMemo } from 'react';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import type { Constraint, ViewState, Language } from './types';
import { translations } from './translations';
import { PlusIcon, TrashIcon, UsersIcon, SparklesIcon, ArrowPathIcon, LinkIcon } from './components/icons';

const App: React.FC = () => {
    const [people, setPeople] = useState<string[]>([]);
    const [personName, setPersonName] = useState('');
    const [groupCount, setGroupCount] = useState<number>(2);

    const [apartConstraints, setApartConstraints] = useState<Constraint[]>([]);
    const [togetherConstraints, setTogetherConstraints] = useState<Constraint[]>([]);
    const [selectedForConstraint, setSelectedForConstraint] = useState<string[]>([]);
    
    const [customGroupNames, setCustomGroupNames] = useState<string[]>(['', '']);
    const [namingMethod, setNamingMethod] = useState<'count' | 'custom'>('count');

    const [groups, setGroups] = useState<string[][]>([]);
    const [groupNames, setGroupNames] = useState<string[]>([]);
    const [groupImages, setGroupImages] = useState<string[]>([]);

    const [view, setView] = useState<ViewState>('setup');
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [language, setLanguage] = useState<Language>('en');

    const t = (key: keyof typeof translations['en']) => translations[language][key];

    const handleAddPerson = () => {
        if (personName && !people.includes(personName)) {
            setPeople([...people, personName.trim()]);
            setPersonName('');
        }
    };

    const handleRemovePerson = (name: string) => {
        setPeople(people.filter(p => p !== name));
        setApartConstraints(prev => prev.filter(c => !c.people.includes(name)));
        setTogetherConstraints(prev => prev.filter(c => !c.people.includes(name)));
        setSelectedForConstraint(prev => prev.filter(p => p !== name));
    };
    
    const handleRemoveConstraint = (type: 'apart' | 'together', index: number) => {
        const setConstraints = type === 'apart' ? setApartConstraints : setTogetherConstraints;
        setConstraints(prev => prev.filter((_, i) => i !== index));
    };

    const handleCreateConstraint = (type: 'apart' | 'together') => {
        if (selectedForConstraint.length < 2) return;
        const newConstraint = { people: [...selectedForConstraint] };
        if (type === 'apart') {
            setApartConstraints(prev => [...prev, newConstraint]);
        } else {
            setTogetherConstraints(prev => [...prev, newConstraint]);
        }
        setSelectedForConstraint([]);
    };

    const toggleSelectedForConstraint = (name: string) => {
        setSelectedForConstraint(prev => 
            prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]
        );
    };
    
    const shuffleArray = <T,>(array: T[]): T[] => {
        let currentIndex = array.length, randomIndex;
        while (currentIndex !== 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
        }
        return array;
    };

    const generateImagesForGroups = useCallback(async (names: string[]): Promise<string[]> => {
        setProcessingMessage(t('generatingImages'));
        const newImages = new Array(names.length).fill('');
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const imagePromises = names.map(async (name, index) => {
                if (!name) return { index, image: '' };
                try {
                    const prompt = `A cute, simple logo for a team named '${name}'.`;
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image',
                        contents: [{ parts: [{ text: prompt }] }],
                        config: { responseModalities: [Modality.IMAGE] },
                    });
                    for (const part of response.candidates?.[0]?.content?.parts || []) {
                        if (part.inlineData) {
                            const base64ImageBytes: string = part.inlineData.data;
                            return { index, image: `data:image/png;base64,${base64ImageBytes}` };
                        }
                    }
                    return { index, image: 'error' };
                } catch (e) {
                    console.error(`Error generating image for ${name}:`, e);
                    return { index, image: 'error' };
                }
            });

            const results = await Promise.all(imagePromises);
            results.forEach(res => {
                newImages[res.index] = res.image;
            });
            return newImages;
        } catch (e) {
            console.error(e);
            setError(t('errorImageGeneration'));
            return new Array(names.length).fill('error');
        }
    }, [t]);

    const generateNames = useCallback(async (currentGroups: string[][]): Promise<string[]> => {
        setProcessingMessage(t('generatingNames'));
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const membersList = currentGroups.map(g => g.join(', ')).join('; ');
            const prompt = `Generate ${currentGroups.length} creative, fun, and short team names for the following groups of people: ${membersList}. The names should be thematic and suitable for a friendly competition or project. Return ONLY a JSON array of strings, like ["Team Awesome", "The Incredibles"].`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                    },
                },
            });

            const jsonStr = response.text.trim();
            const generatedNames = JSON.parse(jsonStr);

            if (Array.isArray(generatedNames) && generatedNames.length === currentGroups.length) {
                return generatedNames;
            } else {
                throw new Error("Invalid name format received.");
            }
        } catch (e) {
            console.error(e);
            setError(t('errorNameGeneration'));
            return currentGroups.map((_, i) => `${t('group')} ${i + 1}`);
        }
    }, [t]);

    const handleGenerateGroups = async () => {
        setError(null);
        
        const finalGroupCount = namingMethod === 'custom'
            ? customGroupNames.filter(name => name.trim() !== '').length
            : groupCount;

        if (namingMethod === 'custom' && finalGroupCount < 2) {
            setError(t('errorMinTwoCustom'));
            return;
        }

        if (people.length < finalGroupCount) {
            setError(t('errorMorePeople'));
            return;
        }

        for (const apart of apartConstraints) {
          for (const together of togetherConstraints) {
            const apartSet = new Set(apart.people);
            const togetherSet = new Set(together.people);
            const intersection = new Set([...apartSet].filter(x => togetherSet.has(x)));
            if (intersection.size >= 2) {
              const conflicted = [...intersection].slice(0, 2);
              setError(`${t('errorConflict')} ${conflicted[0]} & ${conflicted[1]}.`);
              return;
            }
          }
        }
        
        setIsProcessing(true);
        setProcessingMessage(t('generating'));

        try {
            const generatedGroups = await new Promise<string[][] | null>((resolve) => {
                 setTimeout(() => {
                    let success = false;
                    let tempGroups: string[][] = [];

                    for (let attempt = 0; attempt < 50; attempt++) {
                        const parent: { [key: string]: string } = {};
                        people.forEach(p => parent[p] = p);
                        const find = (i: string): string => (parent[i] === i ? i : (parent[i] = find(parent[i])));
                        const union = (i: string, j: string) => {
                            const rootI = find(i);
                            const rootJ = find(j);
                            if (rootI !== rootJ) parent[rootJ] = rootI;
                        };
                        
                        togetherConstraints.forEach(c => {
                            for(let i = 0; i < c.people.length - 1; i++) {
                                union(c.people[i], c.people[i+1]);
                            }
                        });

                        const cliques: { [key: string]: string[] } = {};
                        people.forEach(p => {
                            const root = find(p);
                            if (!cliques[root]) cliques[root] = [];
                            cliques[root].push(p);
                        });
                        
                        const shuffleUnits = Object.values(cliques);
                        if (shuffleUnits.some(unit => unit.length > Math.ceil(people.length / finalGroupCount))) {
                            setError(t('errorCliqueSize'));
                            resolve(null);
                            return;
                        }
                        
                        tempGroups = Array.from({ length: finalGroupCount }, () => []);
                        const shuffledUnits = shuffleArray(shuffleUnits);
                        let possible = true;

                        for (const unit of shuffledUnits) {
                            let placed = false;
                            const groupOrder = tempGroups.map((g, i) => ({g, i})).sort((a,b) => a.g.length - b.g.length).map(item => item.i);
                            
                            for (const i of groupOrder) {
                                 const groupHasApartPerson = tempGroups[i].some(personInGroup => 
                                     unit.some(personInUnit => 
                                        apartConstraints.some(c => c.people.includes(personInGroup) && c.people.includes(personInUnit))
                                     )
                                 );
                                 if (!groupHasApartPerson) {
                                     tempGroups[i].push(...unit);
                                     placed = true;
                                     break;
                                 }
                            }
                            if (!placed) {
                                possible = false;
                                break;
                            }
                        }

                        if (possible) {
                            success = true;
                            break;
                        }
                    }

                    if (success) {
                        const sortedGroups = tempGroups.map(g => g.sort());
                        resolve(sortedGroups);
                    } else {
                        setError(t('errorFailedConstraints'));
                        resolve(null);
                    }
                }, 100);
            });

            if (!generatedGroups) {
                 setIsProcessing(false);
                 return;
            }

            let finalNames: string[];
            if (namingMethod === 'custom') {
                finalNames = customGroupNames.filter(name => name.trim() !== '');
            } else {
                finalNames = await generateNames(generatedGroups);
            }
            
            const finalImages = await generateImagesForGroups(finalNames);
            
            setGroups(generatedGroups);
            setGroupNames(finalNames);
            setGroupImages(finalImages);
            setView('results');

        } catch (err) {
            console.error(err);
            setError(t('errorGeneric'));
        } finally {
            setIsProcessing(false);
            setProcessingMessage('');
        }
    };
    
    const handleGenerateNamesAndImages = async () => {
        if (groups.length > 0) {
            setIsProcessing(true);
            const finalNames = await generateNames(groups);
            const finalImages = await generateImagesForGroups(finalNames);
            setGroupNames(finalNames);
            setGroupImages(finalImages);
            setIsProcessing(false);
        }
    };
    
    const canAddConstraint = useMemo(() => selectedForConstraint.length >= 2, [selectedForConstraint]);
    
    const formatConstraintText = (templateKey: 'constraintApartFormat' | 'constraintTogetherFormat', people: string[]): string => {
        const names = people.map(p => `「${p}」`).join(language === 'ja' ? 'と' : ' & ');
        return t(templateKey).replace('{names}', names);
    }

    if (view === 'results') {
        return (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <h1 className="text-4xl font-extrabold text-center text-rose-800 mb-4">{t('yourNewTeams')}</h1>
                <div className="flex justify-center gap-4 mb-8">
                    <button
                        onClick={() => { setView('setup'); setGroups([]); setGroupNames([]); setGroupImages([]); }}
                        className="bg-rose-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-rose-600 transition-colors shadow-md flex items-center"
                    >
                        <ArrowPathIcon className="h-5 w-5 inline-block mr-2" />
                        {t('startOver')}
                    </button>
                    <button
                        onClick={handleGenerateNamesAndImages}
                        disabled={isProcessing}
                        className="bg-teal-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-teal-600 transition-colors shadow-md disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center"
                    >
                        {isProcessing ? (
                            <>
                                <ArrowPathIcon className="animate-spin h-5 w-5 mr-2" />
                                {t('naming')}
                            </>
                        ) : (
                            <>
                                <SparklesIcon className="h-5 w-5 inline-block mr-2" />
                                {t('generateNames')}
                            </>
                        )}
                    </button>
                </div>
                {error && <p className="text-center text-red-500 font-semibold mb-4">{error}</p>}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                    {groups.map((group, index) => (
                        <div key={index} className="bg-white rounded-2xl shadow-lg p-6 flex flex-col items-center text-center transform hover:scale-105 transition-transform duration-300">
                            <div className="w-32 h-32 mb-4 bg-rose-100 rounded-full flex items-center justify-center overflow-hidden border-4 border-white shadow-inner">
                                {groupImages[index] === 'loading' && (
                                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-rose-500"></div>
                                )}
                                {groupImages[index] === 'error' && (
                                    <div className="text-center text-rose-500 p-2">
                                        <p className="font-semibold text-sm">{t('errorImage')}</p>
                                    </div>
                                )}
                                {groupImages[index] && groupImages[index] !== 'loading' && groupImages[index] !== 'error' && (
                                    <img src={groupImages[index]} alt={groupNames[index] || `${t('group')} ${index + 1}`} className="w-full h-full object-cover" />
                                )}
                            </div>
                            
                            <h3 className="text-2xl font-bold text-rose-800 mb-3 truncate w-full px-2" title={groupNames[index] || `${t('group')} ${index + 1}`}>
                                {groupNames[index] || `${t('group')} ${index + 1}`}
                            </h3>

                            <ul className="space-y-2 w-full">
                                {group.map(person => (
                                    <li key={person} className="bg-rose-50 text-slate-600 font-medium py-2 px-4 rounded-lg">
                                        {person}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    
    return (
        <div className="min-h-screen bg-rose-50">
            {isProcessing && (
                <div className="fixed inset-0 bg-white bg-opacity-80 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white p-10 rounded-2xl shadow-2xl flex flex-col items-center text-center">
                        <ArrowPathIcon className="animate-spin h-12 w-12 text-rose-500 mb-4" />
                        <p className="text-lg font-semibold text-slate-700">{processingMessage}</p>
                    </div>
                </div>
            )}
            <header className="bg-white shadow-md">
                <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-extrabold text-rose-800">Team Shuffler Pro</h1>
                        <p className="mt-1 text-slate-500">{t('subtitle')}</p>
                    </div>
                    <select onChange={(e) => setLanguage(e.target.value as Language)} value={language} className="rounded-md border-slate-300 shadow-sm focus:border-rose-300 focus:ring focus:ring-rose-200 focus:ring-opacity-50">
                        <option value="en">English</option>
                        <option value="ja">日本語</option>
                    </select>
                </div>
            </header>
            <main className="py-10">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 px-4 sm:px-6 lg:px-8">
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white p-8 rounded-2xl shadow-lg">
                            <h2 className="text-2xl font-bold text-rose-800 mb-4 flex items-center"><UsersIcon /> <span className="ml-2">{t('addPeople')}</span></h2>
                            <div className="flex items-center gap-2 mb-4">
                                <input
                                    type="text"
                                    value={personName}
                                    onChange={(e) => setPersonName(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleAddPerson()}
                                    placeholder={t('enterName')}
                                    className="flex-grow p-2 border border-slate-300 rounded-lg focus:ring-rose-500 focus:border-rose-500"
                                />
                                <button onClick={handleAddPerson} className="bg-rose-500 text-white p-2 rounded-lg hover:bg-rose-600 transition-colors flex items-center">
                                    <PlusIcon /> <span className="ml-1 hidden sm:inline">{t('add')}</span>
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {people.map(p => (
                                    <div key={p} className="bg-rose-100 text-rose-800 font-semibold px-3 py-1 rounded-full flex items-center">
                                        {p}
                                        <button onClick={() => handleRemovePerson(p)} className="ml-2 text-rose-500 hover:text-rose-700">
                                            <TrashIcon />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-white p-8 rounded-2xl shadow-lg">
                             <h2 className="text-2xl font-bold text-rose-800 mb-4 flex items-center"><LinkIcon /> <span className="ml-2">{t('addConstraints')}</span></h2>
                            <div className="bg-rose-50 p-4 rounded-lg mb-4">
                                <p className="font-bold mb-3 text-slate-600">{t('selectMembers')}:</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                                    {people.map(p => (
                                        <div key={p} className="flex items-center">
                                            <input 
                                                id={`person-checkbox-${p}`}
                                                type="checkbox"
                                                checked={selectedForConstraint.includes(p)}
                                                onChange={() => toggleSelectedForConstraint(p)}
                                                className="h-4 w-4 text-rose-600 focus:ring-rose-500 border-slate-300 rounded"
                                            />
                                            <label htmlFor={`person-checkbox-${p}`} className="ml-2 text-slate-700 select-none">{p}</label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-4 mb-6">
                                <button onClick={() => handleCreateConstraint('apart')} disabled={!canAddConstraint} className="w-full bg-amber-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-amber-600 disabled:bg-slate-300 transition-colors">{t('keepApart')}</button>
                                <button onClick={() => handleCreateConstraint('together')} disabled={!canAddConstraint} className="w-full bg-teal-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-teal-600 disabled:bg-slate-300 transition-colors">{t('keepTogether')}</button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <h3 className="font-bold mb-2 text-amber-700">{t('apartList')}</h3>
                                    <ul className="space-y-2">
                                        {apartConstraints.map((c, i) => (
                                            <li key={i} className="bg-amber-100 text-amber-800 p-2 rounded-lg flex justify-between items-center text-sm">
                                                <span>{formatConstraintText('constraintApartFormat', c.people)}</span>
                                                <button onClick={() => handleRemoveConstraint('apart', i)} className="text-amber-500 hover:text-amber-700"><TrashIcon /></button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div>
                                    <h3 className="font-bold mb-2 text-teal-700">{t('togetherList')}</h3>
                                     <ul className="space-y-2">
                                        {togetherConstraints.map((c, i) => (
                                            <li key={i} className="bg-teal-100 text-teal-800 p-2 rounded-lg flex justify-between items-center text-sm">
                                                <span>{formatConstraintText('constraintTogetherFormat', c.people)}</span>
                                                <button onClick={() => handleRemoveConstraint('together', i)} className="text-teal-500 hover:text-teal-700"><TrashIcon /></button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white p-8 rounded-2xl shadow-lg self-start sticky top-10">
                         <h2 className="text-2xl font-bold text-rose-800 mb-6">{t('groupSettings')}</h2>
                         <div className="space-y-4 mb-6">
                            <div className="flex items-center">
                                <input type="radio" id="byCount" name="namingMethod" value="count" checked={namingMethod === 'count'} onChange={() => setNamingMethod('count')} className="h-4 w-4 text-rose-600 focus:ring-rose-500 border-slate-300" />
                                <label htmlFor="byCount" className="ml-2 block text-sm font-medium text-slate-700">{t('byGroupCount')}</label>
                            </div>
                             <div className="flex items-center">
                                <input type="radio" id="byName" name="namingMethod" value="custom" checked={namingMethod === 'custom'} onChange={() => setNamingMethod('custom')} className="h-4 w-4 text-rose-600 focus:ring-rose-500 border-slate-300" />
                                <label htmlFor="byName" className="ml-2 block text-sm font-medium text-slate-700">{t('byCustomNames')}</label>
                            </div>
                        </div>

                        {namingMethod === 'count' ? (
                             <div>
                                <label htmlFor="groupCount" className="block text-sm font-bold text-slate-700 mb-1">{t('numGroups')}</label>
                                <input
                                    type="number"
                                    id="groupCount"
                                    min="2"
                                    value={groupCount}
                                    onChange={(e) => setGroupCount(parseInt(e.target.value, 10) || 2)}
                                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-rose-500 focus:border-rose-500"
                                />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                 <label className="block text-sm font-bold text-slate-700 mb-1">{t('customNames')}</label>
                                {customGroupNames.map((name, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            placeholder={`${t('customNamePlaceholder')} ${index + 1}`}
                                            value={name}
                                            onChange={(e) => {
                                                const newNames = [...customGroupNames];
                                                newNames[index] = e.target.value;
                                                setCustomGroupNames(newNames);
                                            }}
                                            className="w-full p-2 border border-slate-300 rounded-lg focus:ring-rose-500 focus:border-rose-500"
                                        />
                                         <button onClick={() => setCustomGroupNames(prev => prev.filter((_, i) => i !== index))} className="text-slate-400 hover:text-slate-600"><TrashIcon /></button>
                                    </div>
                                ))}
                                <button onClick={() => setCustomGroupNames(prev => [...prev, ''])} className="text-rose-500 font-semibold text-sm hover:text-rose-700">{t('addTeamName')}</button>
                            </div>
                        )}

                        <div className="mt-8">
                           {error && <p className="text-center text-red-500 font-semibold mb-4">{error}</p>}
                            <button
                                onClick={handleGenerateGroups}
                                disabled={isProcessing || people.length < 2}
                                className="w-full bg-rose-500 text-white font-extrabold text-lg py-3 px-4 rounded-lg hover:bg-rose-600 disabled:bg-slate-400 transition-colors shadow-lg flex items-center justify-center"
                            >
                                {isProcessing ? (
                                    <>
                                        <ArrowPathIcon className="animate-spin h-5 w-5 mr-2" />
                                        {t('generating')}
                                    </>
                                ) : (
                                    t('shuffleTeams')
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;