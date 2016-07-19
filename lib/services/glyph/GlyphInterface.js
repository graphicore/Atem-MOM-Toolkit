define([
    'Atem-Errors/errors'
  , 'Atem-CPS/emitterMixin'
  // needed for _cpsUIInitDrag
  , 'Atem-Property-Language/parsing/ASTOperation'
  , 'Atem-Property-Language/parsing/ASTGrouping'
  , 'Atem-Property-Language/parsing/_VoidToken'
  , 'Atem-Property-Language/flavours/MOM/Expression'
  , 'Atem-MOM/cpsTools'
  , 'Atem-Property-Language/UI'
  , 'Atem-Math-Tools/Vector'

], function(
    errors
  , emitterMixin
  , ASTOperation
  , ASTGrouping
  , _VoidToken
  , Expression
  , cpsTools
  , UI
  , Vector
) {
    "use strict";
    /* jshint esnext:true */

    var svgns = 'http://www.w3.org/2000/svg'
      , KeyError = errors.Key
      , emitterMixinSetup = {
            stateProperty: '_channel'
          , onAPI: 'on'
          , offAPI: 'off'
          , triggerAPI: '_trigger'
        }
      ;

    function makeLabelText(momNode) {
        var label = [
                momNode.type
              , ':i('+ momNode.index +')'
          ]
          , classes = momNode.classes
          , i, l
          ;

        if(momNode.id)
            label.push('#' + momNode.id);

        for(i=0,l=classes.length;i<l;i++)
            label.push('.' + classes[i]);

        // we currently have no better way to show classes of penstroke point
        // because these are not directly represented in the interface.
        // That will change when <center> will be removed an <point> will
        // take over it's duties. (which name will be kept is not decided yet)
        // https://github.com/metapolator/metapolator/issues/323#issuecomment-72224480
        if(momNode.parent.type === 'point')
            label.unshift(makeLabelText(momNode.parent) + ' ');
        return label.join('');
    }

    function setTitle ( momNode, dom ) {
        var label = makeLabelText(momNode)
          , title = dom.ownerDocument.createElementNS(svgns, 'title')
          ;
        title.appendChild(dom.ownerDocument.createTextNode(label));
        dom.appendChild(title);
    }

    function attachCircle(element, vector, r) {
        var child = element.ownerDocument.createElementNS(svgns, 'circle');
        child.setAttribute('cx', vector[0]);
        child.setAttribute('cy', vector[1]);
        child.setAttribute('r', r);
        element.appendChild(child);
    }

    function attachPoint(pointLikeMomNode, element) {
        var style = pointLikeMomNode.getComputedStyle()
          // these are all Vectors or false
          , onPos = style.get('on', false)
          , inPos = style.get('in', false)
          , outPos = style.get('out', false)
          ;

        if(onPos)
            attachCircle(element, onPos, 4);
        if(inPos)
            attachCircle(element, inPos, 2);
        if(outPos)
            attachCircle(element, outPos, 2);
    }


    /**
     * This will become something like a layer-renderer API ...
     *
     * At the moment the default/normal use case is to just render glyph within
     * an svg element.
     *
     * When calling
     *      this.switchLayers(true);
     * the item changes to switch
     * on mouseenter to a display model where individual mom-nodes can
     * be selected via mouse click.
     * To receive notification of that selection you got to register a callback:
     *      this.on('select-mom', callback[, mydata])
     * where
     *      function callback(mydata or undefined, 'select-mom', selectedMOMNode){}
     *
     *
     * It is very gross in design at the moment. When I know more about
     * our diverse rendering needs there will be a refactoring. Until
     * then maybe you can tell us your wishlist in the issue tracker.
     * I'm thinking something roughly like a MOM GUI Toolkit with modular
     * reusable objects.
     *
     * TODO: make dependencies more explicit.
     */
    function GlyphInterface(document, layerSource, services, glyph, options_) {
        emitterMixin.init(this, emitterMixinSetup);
        this._doc = document;
        this._mom = glyph;
        var options = options_ || {};


        this.element = this._createElement();
        this._container = this._doc.createElementNS(svgns, 'g');
        this._nodeIds2Mom = Object.create(null);
        this._listenTo(this._mom, this.element);
        this.element.appendChild(this._container);


        // Concerned with keeping the box size in sync with the glyph
        this._setViewBox(this._getViewBox());
        this._subscriptionId = this._mom.on('CPS-change', [this, '_cpsChangeHandler']);
        // Needs subscription to fontinfo when we start to change that ...
        this._transformation = null;
        this._setTransformation(glyph);

        // concerned with the display content of the element
        this._layerSource = layerSource;
        this._services = services;
        this._subscriptions = null;
        this._layerElements = null;
        this._currentDisplaySet = null;
        this._displaySets = {
            simple: {'full': true}
          , detailed: {'shapes': true, 'centerline': true, 'meta': true, 'points': true, 'cpsui': true}
        };

        this.__selectNodeHandler = this._selectNodeHandler.bind(this);

        // default;
        if(options.showControls)
            this.showControls();
        else
            this.hideControls();

    }

    var _p = GlyphInterface.prototype;
    _p.constructor = GlyphInterface;
    emitterMixin(_p, emitterMixinSetup);

    _p.showControls = function() {
        this._switchDisplaySet('detailed');
        this.element.addEventListener('click', this.__selectNodeHandler);
    };

    _p.hideControls = function() {
        this._switchDisplaySet('simple');
        this.element.removeEventListener('click', this.__selectNodeHandler);
    };

    _p._makeLayer = function(key) {
        var layerElement, subscription;
        switch(key) {
            case ('shapes'):
                layerElement = this._doc.createElementNS(svgns, 'g');
                layerElement.classList.add('layer', 'layer-shapes');
                subscription = this._drawShapeHandles(this._services.shapes, layerElement, this._mom);
                break;
            case ('points'):
                layerElement = this._doc.createElementNS(svgns, 'g');
                layerElement.classList.add('layer', 'layer-pointlike');
                subscription = this._drawPointHandles(layerElement, this._mom);
                break;
            case ('cpsui'):
                // Eventually this could be in another display set than
                // "default" (maybe "edit" or "cps-ui"), then the different
                // controls would not cover each other and a nice separation
                // between the different concepts would be there.
                // such display sets could also be provided via plugins.
                // If someone wants to reinvent the whole glyph interaction
                // that could be the way.
                layerElement = this._doc.createElementNS(svgns, 'g');
                layerElement.classList.add('layer', 'layer-cpsui');
                subscription = this._initCPSUI(layerElement, this._mom);
                break;
            default:
                subscription = this._layerSource[key].get(this._mom);
                layerElement = subscription.value;
                layerElement.classList.add('layer', 'layer-'+key);
        }
        return [layerElement, subscription];
    };

    _p._switchDisplaySet = function(displaySet) {
        var k, elem, result, oldElements, oldSubscriptions;
        if(this._currentDisplaySet === displaySet)
            return;
        this._currentDisplaySet = displaySet;

        oldElements = this._layerElements;
        oldSubscriptions = this._subscriptions;
        this._layerElements = [];
        this._subscriptions = {layers: []};

        // build new
        for(k in this._displaySets[displaySet]) {
            result = this._makeLayer(k);
            elem = result[0];
            this._layerElements.push(elem);
            this._container.appendChild(elem);
            if(k !== 'points' && k !== 'shapes' && k !== 'cpsui')
                this._subscriptions.layers.push(result[1]);
            else
                this._subscriptions[k] = result[1];
        }

        // clean up late, so that caches don't get
        // pruned and reloaded just a moment later
        if(oldSubscriptions)
            this._destroySubscriptions(oldSubscriptions);
        // Avoid a flash of no layer content by removing to old elements
        // after adding the new ones.
        while(oldElements && (elem = oldElements.pop()))
            this._container.removeChild(elem);
    };

    _p._drawShapeHandles = function(shapesService, layer, momGlyph) {
        var shapes = []
         , children = momGlyph.children
         , child, i, l, item, dom
         ;

        for(i=0,l=children.length;i<l;i++) {
            child = children[i];
            item = shapesService.get(child);
            dom = item.value;
            setTitle(child, dom);
            dom.classList.add('type-' + child.type);
            this._listenTo(child, dom);
            layer.appendChild(dom);
            shapes.push([child, item]);
        }
        return shapes;
    };

    _p._drawPointHandles = function(layer, momGlyph) {
        var points = []
          , pointLike = new Set(['p', 'left', 'center', 'right'])
          , stack = [momGlyph]
          , point, child, dom
          ;

        // I think there can be a lot of power in categorizing elements
        // into groups, like pointLike or surfaceLike etc..
        // see the incredible power below.
        // (When we introduce MOM-changes this becomes a bit more diversified though)
        while( (child = stack.pop()) ) {
            if(pointLike.has(child.type)) {
                // got to listen to child.on('CPS-change'), reminds of _MOMTransformationCache
                // However, we don't do write once <use> anywhere here.
                point = {
                    mom: child
                  , subscriptionId: null
                  , dom: this._doc.createElementNS(svgns, 'g')
                };
                // so we can track point movement
                point.subscriptionId = child.on('CPS-change', [this, '_pointChanged'], point);
                this._pointChanged(point); //initialization
                dom = point.dom;
                dom.classList.add('point-like', 'type-' + child.type);
                this._listenTo(child, dom);
                layer.appendChild(dom);
                points.push(point);
            }
            // recursion
            Array.prototype.push.apply(stack, child.children.reverse());
        }
        return points;
    };

    //////////
    //CPS*UI//
    //////////
    function uiVectorFilter(item) {
        return item && (item instanceof UI) && (item.value instanceof Vector);
    }

    function* cpsuiPropertiesGenerator(styleDict, filter) {
        var keys = styleDict.keys
          , key, i, l, item
          ;
        for(i=0,l=keys.length;i<l;i++) {
            key = keys[i];
            item = styleDict.get(key, null);
            if(!filter(item))
                continue;
            yield key;
        }
    }

    //////
    // tools for _cpsUIInitDrag
    //////
    function replaceItemInAST(item, oldItem, newItem) {
        if(item === oldItem)
            return newItem;
        if(item instanceof ASTGrouping)
            return  replaceItemInASTGrouping(item, oldItem, newItem);
        if(item instanceof ASTOperation)
            return replaceItemInASTOperation(item, oldItem, newItem);
        // not changed
        return item;
    }

    function replaceItemInASTGrouping(grouping, oldItem, newItem) {
        // keep branches unchanged that are not changed by inserting newOperation
        var result
          , oldNodes = grouping.nodes
          , i, l, item
          , newNodes = []
          , changed = false
          ;
        for(i=0,l=oldNodes.length;i<l;i++) {
            item = oldNodes[i];
            result = replaceItemInAST(item, oldItem, newItem);
            newNodes.push(result);
            if(result !== item)
                changed = true;
        }
        return (changed
                    ? new ASTGrouping(grouping.groupingToken, newNodes)
                    : grouping);
    }

    function replaceItemInASTOperation(operation, oldItem, newItem) {
        // keep branches unchanged that are not changed by inserting newOperation
        var result
          , key, oldArgs, newArgs, i, l, item
          , allNewArgs = {
                postArguments: []
              , preArguments: []
            }
          , changed = false
          ;
        for(key in allNewArgs) {
            oldArgs = operation[key];
            newArgs = allNewArgs[key];
            for(i=0,l=oldArgs.length;i<l;i++) {
                item = oldArgs[i];
                result = replaceItemInAST(item, oldItem, newItem);
                newArgs.push(result);
                if(result !== item)
                    changed = true;
            }
        }
        return (changed
                    ? new ASTOperation(operation.operator
                                     , allNewArgs.preArguments
                                     , allNewArgs.postArguments)
                    : operation);
    }

    function replaceProperty(propertyDict, oldProperty, newProperty) {
        var propertyIndexes = propertyDict.find(oldProperty.name)
          , i, l, index
          ;
        for(i=0,l=propertyIndexes.length;i<l;i++) {
            index = propertyIndexes[i];
            // found
            if(propertyDict.getItem(index) === oldProperty) {
                propertyDict.splice(index, 1, newProperty);
                return true;
            }
        }
        // not found
        return false;
    }

    /**
     *  Return the first none-_VoidToken in args or null;
     */
    function getFirstArg(args) {
        var i,l;
        for(i=0,l=args.length;i<l;i++) {
            if(args[i] instanceof _VoidToken)
                continue;
            return args[i];
        }
        return null;
    }

    function _createSVGPoint(svgElement, x, y) {
        var viewportElement = svgElement.viewportElement === null
                // this is the viewportElement
                ? svgElement
                : svgElement.viewportElement
          , svgPoint = viewportElement.createSVGPoint()
          ;
        if(x) svgPoint.x = x;
        if(y) svgPoint.y = y;
        return svgPoint;
    }

    function toSVGElementCoordinate(svgElement, x, y) {
        var svgPoint = _createSVGPoint(svgElement, x, y)
          , ctm = svgElement.getScreenCTM().inverse()
          ;
        svgPoint.x = x;
        svgPoint.y = y;
        svgPoint = svgPoint.matrixTransform(ctm);
        return new Vector(svgPoint.x, svgPoint.y);
    }

    function getSVGScreenOrigin(svgElement) {
        var svgPoint = _createSVGPoint(svgElement)
          , ctm = svgElement.getScreenCTM()
          ;
        svgPoint = svgPoint.matrixTransform(ctm);
        return new Vector(svgPoint.x, svgPoint.y);
    }

    function updateCPSUI(e) {
        /* jshint validthis:true */
        var newIntrinsic
          , ast = this.property.value.value.ast
          , newAST , newOperation , newProperty, oldProperty
          // like: "(Vector 10 100)"
          // The parenthesis are intentional, so we don't have to know about
          // the nature of the other args;
          , newArgumentFormula, newArgument
          , firstArg
          , delta, initialPos, currentPos
          ;
        currentPos = new Vector(e.clientX, e.clientY)['-'](this.initialOffset);

        currentPos = toSVGElementCoordinate(this.svgElement, currentPos.x, currentPos.y);
        initialPos = toSVGElementCoordinate(this.svgElement, this.initialPos.x, this.initialPos.y);
        delta = currentPos['-'](initialPos);
        if(delta.x === 0 && delta.y === 0)
            return;
        // assert newArgument instanceof ASTGrouping
        // assert newArgument.groupingToken.literal === '('
        firstArg = getFirstArg(this.astOperation.postArguments);
        if(!firstArg)
            // this means there was no none-_VoidToken in postArguments
            throw new Error('A UI item must have at least one argument!');

        newIntrinsic = this.intrinsic['+'](delta);
        newArgumentFormula = ['(Vector ', newIntrinsic.x ,' ', newIntrinsic.y, ')'].join('');
        newArgument = Expression.factory(newArgumentFormula)[1].ast.nodes[0];

        // <==specific | generic==>

        newOperation = replaceItemInAST(this.astOperation, firstArg, newArgument);
        if(newOperation === this.astOperation) {
            // because then we are unable to create a change here, for any reason
            // maybe the property was rewritten by another routine.
            // That means the update process lost its mandate.
            console.warn('newOperation === this.astOperation', newOperation);
            this.stop();
            return;
        }

        newAST = replaceItemInAST(ast, this.astOperation, newOperation);
        if(newAST === ast) {
            // because then we are unable to create a change here, for any reason
            // maybe the property was rewritten by another routine.
            // That means the update process lost its mandate.
            console.warn('newAST === ast', newAST);
            this.stop();
            return;
        }

        newProperty = cpsTools.makeProperty(this.property.name, new Expression(newAST));
        // remember this.property because we want to update it before
        // the call to replaceProperty.
        oldProperty = this.property;
        this.property = newProperty;
        this.astOperation = newOperation;

        // finally, bring the update to the model
        if(!replaceProperty(this.rule.properties, oldProperty, newProperty)) {
            // because then we are unable to create a change here, for any reason
            // maybe the property was rewritten by another routine.
            // That means the update process lost its mandate.
            console.warn('!replaceProperty');
            this.stop();
            return;
        }
    }

    function stopCPSUI(doc, e) {
        /* jshint validthis:true, unused:vars */
        if(e)
            console.log('stop', e);
        doc.removeEventListener('mousemove', this.update, false);
        doc.removeEventListener('mouseup', this.stop, false);
    }

    _p._cpsUIInitDrag = function(subscription, initalEvent) {
        var elem = initalEvent.target
          , index, item, doc, state, initialOffset
          ;
        while(true) {
            if(elem === this.element.parentElement || !elem)
                return;
            if(elem.hasAttribute('data-cps-ui-index'))
                // found!
                break;
            elem = elem.parentElement;
        }
        index = elem.getAttribute('data-cps-ui-index');
        item = subscription.interfaces[index];
        doc = elem.ownerDocument;


        // The idea is that the update process can run as long as
        // the info in state is suficient to find the right place for an
        // update.
        // That way, also, we should be sufficiently decoupled from the display
        // updates, that will happen

        // remove the the part that is offset from element to screen origin
        // because the position of the element may change during the action.
        // e.g. when in a row of simultaneously interpolated glyphs the
        // width changes, all but the first glyph change their positions.
        // If the control used has it's origin in one of the changed
        // glyphs, our initialPos is compromised.
        initialOffset = getSVGScreenOrigin(elem);
        state = {
            initialOffset: initialOffset
          , initialPos: new Vector(initalEvent.clientX, initalEvent.clientY)['-'](initialOffset)
          , svgElement: elem
          , intrinsic: item.uiItem.value
          , rule: item.uiItem.rule
          // methods
          , update: null
          , stop: null
          // these are going to be changed on update:
          , property: item.uiItem.property
          , astOperation: item.uiItem.astOperation
        };

        state.update = updateCPSUI.bind(state);
        state.stop = stopCPSUI.bind(state, doc);

        doc.addEventListener('mousemove', state.update, false);
        doc.addEventListener('mouseup', state.stop, false);
    };

    function updateCPSUIProperty(item, propertyName) {
        var styleDict = item.mom.getComputedStyle()
          , uiItem = styleDict.get(propertyName, null)
          ;
        if(!uiVectorFilter(uiItem)) {
            // remove
            return false;
        }
        // update
        item.uiItem = uiItem;
        drawCPSUIVector(item);
        return true;
    }

    function checkAndAddUIVectors(subscription, mom, keys) {
        var i, l, propertyName, uiItem
          , styleDict = mom.getComputedStyle()
          , properties = subscription.elements.get(mom).properties
          ;
        for(i=0,l=keys.length;i<l;i++) {
            propertyName = keys[i];
            if(properties.has(propertyName))
                continue;
            uiItem = styleDict.get(propertyName, null);
            if(!uiVectorFilter(uiItem))
                continue;
            // this is an uncharted UI-vector
            addUIVector(subscription, mom, propertyName);
        }
    }

    function updateElementCPSUIs(data, channelKey, eventData) {
        var subscription = data[0]
           , mom = data[1]
           , properties, seen
           , i, l, keys, propertyName, item
           , styleDict
           ;

        // process change;
        properties = subscription.elements.get(mom).properties;
        seen = new Set();
        keys = eventData;
        for(i=0,l=keys.length;i<l;i++) {
            propertyName = keys[i];
            if(seen.has(propertyName)
                    // properties wouldn't have this if it was not added
                    // yet. We want to have this checked again below
                    // at detect additions.
                    || !properties.has(propertyName))
                continue;
            seen.add(propertyName);

            item = properties.get(propertyName);
            if(!updateCPSUIProperty(item, propertyName)) {
                // item is no longer a valid ui-item
                item.dom.parentElement.removeChild(item.dom);
                subscription.interfaces[item.dom.getAttribute('data-cps-ui-index')] = null;
                properties.delete(propertyName);
            }
        }

        // detect additions
        styleDict = mom.getComputedStyle();
        keys = styleDict.keys.filter(function(key) {
                // if we have seen it when updating, we're not interested
                // if it is already in properties this is not an addition
                return !(seen.has(key) || properties.has(key));
        });
        checkAndAddUIVectors(subscription, mom, keys);
    }

    function drawCPSUIVector(item) {
        var uiItem = item.uiItem
          , value = uiItem.value
          ;
        while(item.dom.lastChild)
            item.dom.removeChild(item.dom.lastChild);

        if(uiItem.arguments[1] instanceof Vector)
            value = value['+'](uiItem.arguments[1]);
        attachCircle(item.dom, value, 10);
    }

    function addUIVector(subscription, mom, propertyName) {
        var layer = subscription.layer
          , interfaces = subscription.interfaces
          , styleDict = mom.getComputedStyle()
          , uiItem = styleDict.get(propertyName)
          , dom = layer.ownerDocument.createElementNS(svgns, 'g')
          , properties = subscription.elements.get(mom).properties
          , item = {
                    mom: mom
                  , dom: dom
                  , uiItem: uiItem
                }
          ;
        properties.set(propertyName, item);
        // init
        drawCPSUIVector(item);
        // update when the value changes
        // this may be a bit complex:
        //       the property may become outdated
        //       the property may be removed [It is actually replaced ... ]
        //       the key of the styledict may stay the same
        //       but the property changes (actually, the styledict
        //       would trigger cps-change. But we shouldn't throw
        //       all away if we can just update a piece ...

        // styling
        // TODO: cps-ui-type will have to be determined by the actual data type
        dom.classList.add('cpsui', 'type-' + mom.type, 'cps-ui-type-vector');

        // to detect when the item is used
        dom.setAttribute('data-cps-ui-index', interfaces.length);
        layer.appendChild(dom);
        interfaces.push(item);
    }

    _p._initCPSUI = function(layer, momGlyph) {
        var interfaces = []
          , elements = new Map()
          , subscription = {
                layer: layer
              , elements: elements
              , interfaces: interfaces
              , elementMousedown: null
            }
          , stack = [momGlyph]
          , child, styleDict, gen, generatorItem
          , properties
          ;
        subscription.elementMousedown = this._cpsUIInitDrag.bind(this, subscription);
        this.element.addEventListener('mousedown', subscription.elementMousedown);

        while( (child = stack.pop()) ) {
            styleDict = child.getComputedStyle();
            // assert(!elements.has(child));
            properties = new Map();
            elements.set(child, {
                  properties: properties
                , subscriptionID: styleDict.on(['add', 'change'], updateElementCPSUIs, [subscription, child])
            });

            gen = cpsuiPropertiesGenerator(styleDict, uiVectorFilter);
            while(!(generatorItem = gen.next()).done)
                addUIVector(subscription, child, generatorItem.value);
            // recursion
            Array.prototype.push.apply(stack, child.children.reverse());
        }
        return subscription;
    };

    // update point position
    _p._pointChanged = function(point) {
        while(point.dom.lastChild)
            point.dom.removeChild(point.dom.lastChild);
        setTitle(point.mom, point.dom);
        attachPoint(point.mom, point.dom);
    };

    _p._registerMomNode = function(momNode) {
        // TODO: A "give me the nodeID I return the node item" facility
        // should probably become part of the Node API.
        var entry = this._nodeIds2Mom[momNode.nodeID];
        if(!entry)
            entry = this._nodeIds2Mom[momNode.nodeID] = [0, momNode];
        entry[0] += 1;
    };

    _p._unregisterMomNode = function(momNode) {
        var entry = this._nodeIds2Mom[momNode.nodeID];
        if(!entry) return;
        entry[0] -= 1;
        if(entry[0] <= 0)
            delete this._nodeIds2Mom[momNode.nodeID];
    };

    _p._getRegisteredMomNode = function(nodeID) {
        var entry = this._nodeIds2Mom[nodeID];
        if(!entry)
            throw new KeyError('MOM-Node with nodeID '+ nodeID + 'not found.');
        return entry[1];
    };

    _p._listenTo = function(momNode, dom) {
        dom.setAttribute('data-node-id', momNode.nodeID);
        this._registerMomNode(momNode);
    };

    _p._selectNodeHandler = function(event) {
        var elem = event.target;
        while(true) {
            if(elem === this.element.parentElement || !elem)
                return;
            if(elem.hasAttribute('data-node-id'))
                // found!
                break;
            elem = elem.parentElement;
        }
        var id = elem.getAttribute('data-node-id')
          , mom = this._getRegisteredMomNode(id)
          ;
        this._trigger('select-mom', mom);
    };

    _p._cpsChangeHandler = function(ownData, channel, eventData) {
        //jshint unused: vars
        var viewBox = this._getViewBox();
        if(this._viewBox.join(' ') !== viewBox.join(' ')) {
            this._setViewBox(viewBox);
            this._trigger('viewBox-change', viewBox);
        }
    };

    _p._layerChangeHandler = function(ownData, _channel, eventData) {
        this._trigger(ownData.channel, eventData);
    };

    _p._setViewBox = function(viewbox) {
        this._viewBox = viewbox;
        this.element.setAttribute('viewBox', this._viewBox.join(' '));
    };

    /**
     * FIXME: MOM.master.fontinfo.unitsPerEm must be subscribed to in
     * the future, when we start changing it!
     *
     * updating "advanceWidth" is already covered by the normal redraw flow.
     *
     * For horizontal written languages:
     *      width is advanceWidth
     *      height is should the font height (fontinfo.unitsPerEm)
     */
    _p._getViewBox = function() {
        var styledict = this._mom.getComputedStyle()
          , width
          , height = this._getFontInfo(this._mom.master).unitsPerEm || 1000
          ;

        try {
            width = styledict.get('width');
        }
        catch(e){
            if(!(e instanceof KeyError))
                throw e;
            // FIXME: we should inform the user of this problem
            width = height;
        }
        // ViewBox min width can't be less than 0.
        width = Math.max(0, width);
        height = Math.max(0, height);

        return [0, 0, width, height];
    };

    _p._getFontInfo = function ( master ) {
        return master.getAttachment('fontinfo', true) || {};
    };

    _p._getTransformation = function ( master ) {
        // FIXME: * One day we have to subscribe to unitsPerEm AND
        //          descender for this!
        //        * I guess this is only valid for horizontal writing systems.
        //        * Maybe moveUp is rather === ascender?
        // ascender can be < fontinfo.unitsPerEm - fontinfo.descender, then
        // this solution is better. It seems OK to give the font enough
        // room down and maximal room upwards.
        var fontinfo = this._getFontInfo(master)
          , moveUp = (fontinfo.unitsPerEm || 1000) + (fontinfo.descender || 0)
          , matrix = [1, 0, 0, -1, 0, moveUp]
          ;
        return matrix.join(',');
    };

    /**
     * Returns true when the transformation actually changed otherwise false
     */
    _p._setTransformation = function(mom) {
        var transformation = this._getTransformation(mom.master);
        if(this._transformation === transformation)
            return false;
        this._transformation = transformation;
        // this transformation is evil! it breaks using transformation for
        // components
        this._container.setAttribute('transform', 'matrix(' +  transformation + ')');
        return true;
    };

    _p._createElement = function() {
        var svg = this._doc.createElementNS(svgns, 'svg');
        // This can be set via css as well, but since it is the only
        // choice that really makes sense, we may be happy for ever when
        // setting it here
        svg.setAttribute('overflow', 'visible');

        // Using inline-block fails for Chromium. Filed a bug:
        // https://code.google.com/p/chromium/issues/detail?id=462107
        // thus, these svgs should be packed inside a container that is
        // display: inline-block
        svg.style.display = 'block';
        return svg;
    };

    _p._destroySubscriptions = function(subscriptions) {
        var k;
        for(k in subscriptions) {
            this._destructors[k].call(this, subscriptions[k]);
            delete subscriptions[k];
        }
    };

    _p._destructors = {
        layers: function (items) {
            var i,l;
            for(i=0,l=items.length;i<l;i++)
                items[i].destroy();
        }
      , shapes: function (items) {
            var i,l;
            for(i=0,l=items.length;i<l;i++) {
                this._unregisterMomNode(items[i][0]);
                items[i][1].destroy();
            }
        }
      , points: function (points) {
            var i,l,point;
            for(i=0,l=points.length;i<l;i++) {
                point = points[i];
                this._unregisterMomNode(point.mom);
                point.mom.off(point.subscriptionId);
            }
        }
      , cpsui: function (subscription) {
            this.element.removeEventListener(
                            'mousedown', subscription.elementMousedown);

            subscription.elements.forEach(function(data, element) {
                var styleDict = element.getComputedStyle();
                styleDict.off(data.subscriptionID);
            });

        }
    };

    _p.destroy = function() {
        this._destroySubscriptions(this._subscriptions);
        this._mom.off(this._subscriptionId);
    };

    return GlyphInterface;
});
