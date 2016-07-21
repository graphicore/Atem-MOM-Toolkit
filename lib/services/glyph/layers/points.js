define([
], function(
) {
    "use strict";
    /* jshint esnext:true */

    var svgns = 'http://www.w3.org/2000/svg';
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

    // update point position
    function updatePoint(point) {
        while(point.dom.lastChild)
            point.dom.removeChild(point.dom.lastChild);
        setTitle(point.mom, point.dom);
        attachPoint(point.mom, point.dom);
    }

    function init(layer, momGlyph) {
        var subscription = {
                items: []
              , elementClick: null
            }
          , items = subscription.items
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
                  , dom: layer.ownerDocument.createElementNS(svgns, 'g')
                };
                // so we can track point movement
                point.subscriptionId = child.on('CPS-change', updatePoint, point);
                //initialization
                updatePoint(point);

                dom = point.dom;
                dom.classList.add('point-like', 'type-' + child.type);
                dom.setAttribute('data-point-index', items.length);

                layer.appendChild(dom);
                items.push(point);
            }
            // recursion
            Array.prototype.push.apply(stack, child.children.reverse());
        }
        return subscription;
    }

    // Maybe, instead of trigger, a 'selectNode' method could be passed,
    // or `nodeClicked` ?
    // At some point the semantic mapping from cause to effect needs to take
    // place.
    function selectNodeHandler(hostElement, subscription, trigger, event) {
        var elem = event.target
          , items = subscription.items
          ;
        if(event.defaultPrevented) return;
        while(true) {
            if(elem === hostElement.parentElement || !elem)
                return;
            if(elem.hasAttribute('data-point-index'))
                // found!
                break;
            elem = elem.parentElement;
        }

        event.preventDefault();
        var index = elem.getAttribute('data-point-index')
          , mom = items[index].mom
          ;
        trigger(mom);
    }

    function create (glyphInterface) {
        var layerElement = glyphInterface.document.createElementNS(svgns, 'g')
          , subscription = init(layerElement, glyphInterface.glyph)
           // FIXME! private API
           // NOTE: maybe in the futer we could configure the event OR
           //       make a description so that we can rewire it, in a sense,
           //       live from within the application
          , trigger = glyphInterface._trigger.bind(glyphInterface, 'select-mom')
          ;

        subscription.elementClick = selectNodeHandler.bind(
                                    null
                                  , glyphInterface.element
                                  , subscription
                                  , trigger);
        glyphInterface.element.addEventListener(
                        'click', subscription.elementClick);

        return [layerElement, subscription];
    }

    function destroy (glyphInterface, layerElement, subscription) {
        var i,l,item;

        glyphInterface.element.removeEventListener(
                        'click', subscription.elementClick);

        for(i=0,l=subscription.items.length;i<l;i++) {
            item = subscription.items[i];
            item.mom.off(item.subscriptionId);
        }
    }

    return {
        create: create
      , destroy: destroy
    };
});
